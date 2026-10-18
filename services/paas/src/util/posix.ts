/** Narrow POSIX adapter: callers never supply arbitrary relative paths. */
import { constants, fstatSync, fsyncSync, readSync } from "node:fs";
import { getSystemErrorName } from "node:util";
import { TextDecoder } from "node:util";
import koffi from "koffi";

if (!["linux", "darwin"].includes(process.platform) || !["arm64", "x64"].includes(process.arch)) {
  throw new Error("host storage requires Linux or macOS on arm64 or x64");
}
const darwin = process.platform === "darwin";
const libc = koffi.load(darwin ? "/usr/lib/libSystem.B.dylib" : "libc.so.6");
const nativeClose = libc.func("int close(int fd)") as (fd: number) => number;
// openat is variadic; Darwin arm64 passes its mode argument on the stack.
const nativeOpenat = libc.func("int openat(int fd, const char *path, int flags, ...)") as (
  fd: number,
  path: string,
  flags: number,
  modeType: "uint",
  mode: number,
) => number;
const openat = (fd: number, path: string, flags: number, mode: number) =>
  nativeOpenat(fd, path, flags, "uint", mode);
const mkdirat = libc.func("int mkdirat(int fd, const char *path, unsigned int mode)") as (
  fd: number,
  path: string,
  mode: number,
) => number;
const renameat = libc.func(
  "int renameat(int fromfd, const char *from, int tofd, const char *to)",
) as (fromfd: number, from: string, tofd: number, to: string) => number;
const unlinkat = libc.func("int unlinkat(int fd, const char *path, int flags)") as (
  fd: number,
  path: string,
  flags: number,
) => number;
const flock = libc.func("int flock(int fd, int operation)") as (
  fd: number,
  operation: number,
) => number;
// Darwin x64 retains legacy directory-entry symbols; select the 64-bit ABI.
const suffix = darwin && process.arch === "x64" ? "$INODE64" : "";
const fdopendir = libc.func(`fdopendir${suffix}`, "void *", ["int"]) as (fd: number) => unknown;
const readdir = libc.func(`readdir${suffix}`, "void *", ["void *"]) as (
  directory: unknown,
) => unknown;
const closedir = libc.func("int closedir(void *directory)") as (directory: unknown) => number;
const CLOEXEC = darwin ? 0x1000000 : 0x80000;
const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | CLOEXEC;
const CURRENT_DIRECTORY = darwin ? -2 : -100;
const LOCK_EXCLUSIVE_NONBLOCKING = 2 | 4;

export class PosixError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`host filesystem: ${code}`);
    this.name = "PosixError";
    this.code = code;
  }
}
export function systemCode(error: unknown): string | undefined {
  return error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}
// Native descriptors belong to this adapter, not Node's worker descriptor tracker.
export function closeDescriptor(fd: number) {
  if (nativeClose(fd) < 0) throw new PosixError(getSystemErrorName(-koffi.errno()));
}
function checked(operation: () => number): number {
  for (;;) {
    const value = operation();
    if (value >= 0) return value;
    const errno = koffi.errno();
    if (errno === koffi.os.errno["EINTR"]) continue;
    throw new PosixError(getSystemErrorName(-errno));
  }
}
function component(name: string) {
  if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\0"))
    throw new PosixError("EINVAL");
}
export type FilePolicy = "public" | "secret" | "private";

export class Directory {
  #fd: number | undefined;
  constructor(fd: number) {
    this.#fd = fd;
  }
  private descriptor(): number {
    if (this.#fd === undefined) throw new PosixError("EBADF");
    return this.#fd;
  }
  close() {
    if (this.#fd !== undefined) {
      const fd = this.#fd;
      this.#fd = undefined;
      closeDescriptor(fd);
    }
  }
  sync() {
    fsyncSync(this.descriptor());
  }
  directory(name: string, create: boolean, privateMode = true): Directory {
    component(name);
    if (create) {
      try {
        checked(() => mkdirat(this.descriptor(), name, 0o700));
        this.sync();
      } catch (error) {
        if (systemCode(error) !== "EEXIST") throw error;
      }
    }
    const fd = checked(() => openat(this.descriptor(), name, DIRECTORY_FLAGS, 0));
    try {
      const info = fstatSync(fd);
      if (
        !info.isDirectory() ||
        (privateMode &&
          ((info.mode & 0o777) !== 0o700 || info.uid !== fstatSync(this.descriptor()).uid))
      )
        throw new PosixError("EACCES");
      return new Directory(fd);
    } catch (error) {
      closeDescriptor(fd);
      throw error;
    }
  }
  file(name: string, flags: number, policy: FilePolicy): number {
    component(name);
    const fd = checked(() =>
      openat(
        this.descriptor(),
        name,
        flags | constants.O_NOFOLLOW | constants.O_NONBLOCK | CLOEXEC,
        0o600,
      ),
    );
    try {
      const info = fstatSync(fd);
      const mode = info.mode & 0o777;
      if (
        !info.isFile() ||
        (policy === "secret" && ![0o400, 0o600].includes(mode)) ||
        (policy === "private" && (mode !== 0o600 || info.uid !== fstatSync(this.descriptor()).uid))
      )
        throw new PosixError("EACCES");
      return fd;
    } catch (error) {
      closeDescriptor(fd);
      throw error;
    }
  }
  lock(fd: number) {
    try {
      checked(() => flock(fd, LOCK_EXCLUSIVE_NONBLOCKING));
    } catch (error) {
      if (["EAGAIN", "EWOULDBLOCK"].includes(systemCode(error) ?? ""))
        throw new PosixError("EWOULDBLOCK");
      throw error;
    }
  }
  rename(from: string, to: string) {
    component(from);
    component(to);
    checked(() => renameat(this.descriptor(), from, this.descriptor(), to));
  }
  unlink(name: string) {
    component(name);
    checked(() => unlinkat(this.descriptor(), name, 0));
  }
  entries(): string[] {
    const fd = checked(() => openat(this.descriptor(), ".", DIRECTORY_FLAGS, 0));
    const directory = fdopendir(fd);
    if (!directory) {
      const errno = koffi.errno();
      closeDescriptor(fd);
      throw new PosixError(getSystemErrorName(-errno));
    }
    try {
      const names: string[] = [];
      for (;;) {
        koffi.errno(0);
        const entry = readdir(directory);
        if (!entry) {
          const errno = koffi.errno();
          if (errno !== 0) throw new PosixError(getSystemErrorName(-errno));
          break;
        }
        // d_name offset in the system's 64-bit dirent ABI: Darwin 21, glibc 19.
        const name: unknown = koffi.decode(entry, darwin ? 21 : 19, "char", -1);
        if (typeof name !== "string") throw new PosixError("EIO");
        if (name !== "." && name !== "..") names.push(name);
        if (names.length > 16_384) throw new PosixError("EOVERFLOW");
      }
      return names;
    } finally {
      checked(() => closedir(directory));
    }
  }
}

export function openRoot(path: string): Directory {
  if (path.includes("\0")) throw new PosixError("EINVAL");
  return new Directory(checked(() => openat(CURRENT_DIRECTORY, path, DIRECTORY_FLAGS, 0)));
}

/** Bounded no-follow read. Startup-only or worker-only: synchronous by design. */
export function readBounded(
  directory: Directory,
  name: string,
  maximumBytes: number,
  policy: FilePolicy,
): string {
  const fd = directory.file(name, constants.O_RDONLY, policy);
  try {
    if (fstatSync(fd).size > maximumBytes) throw new PosixError("EFBIG");
    const buffer = Buffer.alloc(maximumBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const count = readSync(fd, buffer, offset, buffer.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    if (offset > maximumBytes) throw new PosixError("EFBIG");
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, offset));
  } finally {
    closeDescriptor(fd);
  }
}
