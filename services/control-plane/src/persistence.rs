//! Durable controller metadata. No configuration, resolved secrets, or external effects.
use rustix::fs::{
    AtFlags, FlockOperation, Mode, OFlags, flock, mkdirat, open, openat, renameat, unlinkat,
};
use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    io::{Read, Write},
    os::unix::fs::{MetadataExt, PermissionsExt},
    path::Path,
    sync::Arc,
};
use tokio::sync::{mpsc, oneshot, watch};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Snapshot<D = NoDesiredState> {
    pub schema_version: u32,
    pub generation: u64,
    pub installation_id: String,
    pub cluster_id: String,
    pub records: Vec<Record<D>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Record<D = NoDesiredState> {
    pub id: String,
    pub version: u32,
    pub generation: u64,
    pub data: RecordData<D>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum RecordData<D = NoDesiredState> {
    Reservation {
        service_id: String,
        name: String,
    },
    Approval {
        service_id: String,
        administrator: String,
        revision: String,
    },
    Desired {
        service_id: String,
        revision: String,
        digest: String,
        snapshot: D,
    },
    Inventory {
        service_id: String,
        target: ObjectTarget,
        ownership_token: String,
        uid: Option<String>,
        lifecycle: Lifecycle,
    },
    Revision {
        service_id: String,
        revision: String,
        phase: RevisionPhase,
    },
    Operation {
        service_id: String,
        intent: OperationIntent,
        state: OperationState,
    },
}
/// Cluster identity is the enclosing snapshot binding; no invented UID for pending creates.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ObjectTarget {
    pub api_group: String,
    pub resource: String,
    pub api_version: String,
    pub kind: String,
    pub namespace: Option<String>,
    pub name: String,
}
impl ObjectTarget {
    fn required_fields(&self) -> Vec<&str> {
        let mut fields = vec![
            self.resource.as_str(),
            &self.api_version,
            &self.kind,
            &self.name,
        ];
        if let Some(namespace) = &self.namespace {
            fields.push(namespace);
        }
        fields
    }
}
/// Implement only for canonical normalized descriptors that reject inline secrets.
/// Validation must bound content and references; the store bounds serialized bytes.
pub trait DesiredState:
    std::fmt::Debug + Clone + Eq + Serialize + serde::de::DeserializeOwned + Send + Sync + 'static
{
    fn validate(&self) -> Result<(), StoreError>;
}
/// Until a canonical descriptor type is supplied, desired records cannot be constructed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum NoDesiredState {}
impl DesiredState for NoDesiredState {
    fn validate(&self) -> Result<(), StoreError> {
        match *self {}
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OperationIntent {
    pub action: OperationAction,
    pub target_record_id: String,
    pub desired_generation: u64,
    pub idempotency_key: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OperationAction {
    Create,
    Apply,
    Delete,
    Materialize,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Lifecycle {
    Runtime,
    Retained,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RevisionPhase {
    Accepted,
    Applied,
    Healthy,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub enum OperationState {
    Pending,
    Succeeded,
    Failed { code: String },
}

#[derive(Debug)]
pub enum StoreError {
    Io(std::io::ErrorKind),
    AlreadyRunning,
    RecoveryRequired,
    InvalidSnapshot,
    UnsupportedVersion(u32),
    BindingMismatch,
    Capacity,
    StaleGeneration,
    IndeterminateCommit,
    Halted,
    Closed,
}
impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "controller metadata: {self:?}; stop effects and inspect the canonical state directory"
        )
    }
}
impl std::error::Error for StoreError {}

const MAX_BYTES: usize = 4 * 1024 * 1024;
const MAX_RECORDS: usize = 4096;
const SCHEMA: u32 = 2;
type CommitReply<D> = oneshot::Sender<Result<Arc<Snapshot<D>>, StoreError>>;
enum Command<D> {
    Commit(u64, Vec<Record<D>>, CommitReply<D>),
}
pub struct Store<D = NoDesiredState> {
    sender: mpsc::Sender<Command<D>>,
    view: watch::Receiver<Arc<Snapshot<D>>>,
    worker: tokio::task::JoinHandle<()>,
    halted: watch::Receiver<bool>,
}
impl<D: DesiredState> Store<D> {
    /// `fresh` authorizes initialization only when no prior managed storage exists.
    pub async fn open(
        root: &Path,
        installation: &str,
        cluster: &str,
        fresh: bool,
    ) -> Result<Self, StoreError> {
        let (root, installation, cluster) =
            (root.to_owned(), installation.to_owned(), cluster.to_owned());
        let writer = tokio::task::spawn_blocking(move || {
            Writer::open(&root, &installation, &cluster, fresh)
        })
        .await
        .map_err(|_| StoreError::Closed)??;
        Ok(Self::start(writer))
    }
    fn start(mut writer: Writer<D>) -> Self {
        let (publisher, view) = watch::channel(writer.current.clone());
        let (halt_publisher, halted) = watch::channel(false);
        let (sender, mut receiver) = mpsc::channel(16);
        let worker = tokio::task::spawn_blocking(move || {
            while let Some(Command::Commit(expected, records, reply)) = receiver.blocking_recv() {
                let result = writer.commit(expected, records);
                halt_publisher.send_replace(writer.halted);
                if let Ok(snapshot) = &result {
                    publisher.send_replace(snapshot.clone());
                }
                let _ = reply.send(result);
            }
        });
        Self {
            sender,
            view,
            worker,
            halted,
        }
    }
    pub fn snapshot(&self) -> Arc<Snapshot<D>> {
        self.view.borrow().clone()
    }
    /// Runtime effect dispatch must check this gate after a durable storage failure.
    pub fn ensure_writable(&self) -> Result<(), StoreError> {
        if *self.halted.borrow() || self.sender.is_closed() {
            Err(StoreError::Halted)
        } else {
            Ok(())
        }
    }
    /// Replaces the complete record set atomically; unchanged records retain generations.
    /// Stable operation record IDs resolve successful commits whose response was lost.
    pub async fn commit(
        &self,
        expected: u64,
        records: Vec<Record<D>>,
    ) -> Result<Arc<Snapshot<D>>, StoreError> {
        bounded_records(&records)?;
        let (reply, response) = oneshot::channel();
        self.sender
            .try_send(Command::Commit(expected, records, reply))
            .map_err(|error| match error {
                mpsc::error::TrySendError::Full(_) => StoreError::Capacity,
                mpsc::error::TrySendError::Closed(_) => StoreError::Closed,
            })?;
        response.await.map_err(|_| StoreError::Closed)?
    }
    /// Drain accepted disk commits before releasing the lifetime lock.
    pub async fn shutdown(self) -> Result<(), StoreError> {
        drop(self.sender);
        self.worker.await.map_err(|_| StoreError::Closed)
    }
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq)]
enum Fault {
    Write,
    FileSync,
    Rename,
    DirectorySync,
    LostResponse,
}
struct Writer<D = NoDesiredState> {
    directory: File,
    _lock: File,
    current: Arc<Snapshot<D>>,
    halted: bool,
    sequence: u64,
    #[cfg(test)]
    fault: Option<Fault>,
}
fn io(error: impl Into<std::io::Error>) -> StoreError {
    StoreError::Io(error.into().kind())
}
fn directory(parent: &File, name: &str, create: bool) -> Result<File, StoreError> {
    if create {
        match mkdirat(parent, name, Mode::from_raw_mode(0o700)) {
            Ok(()) => parent.sync_all().map_err(io)?,
            Err(rustix::io::Errno::EXIST) => {}
            Err(error) => return Err(io(error)),
        }
    }
    let file = File::from(
        openat(
            parent,
            name,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(io)?,
    );
    let metadata = file.metadata().map_err(io)?;
    if metadata.permissions().mode() & 0o777 != 0o700
        || metadata.uid() != parent.metadata().map_err(io)?.uid()
    {
        return Err(StoreError::Io(std::io::ErrorKind::PermissionDenied));
    }
    Ok(file)
}
fn open_file(directory: &File, name: &str, flags: OFlags) -> Result<File, StoreError> {
    let file = File::from(
        openat(
            directory,
            name,
            flags | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK,
            Mode::from_raw_mode(0o600),
        )
        .map_err(io)?,
    );
    let metadata = file.metadata().map_err(io)?;
    if !metadata.is_file()
        || metadata.permissions().mode() & 0o777 != 0o600
        || metadata.uid() != directory.metadata().map_err(io)?.uid()
    {
        return Err(StoreError::Io(std::io::ErrorKind::PermissionDenied));
    }
    Ok(file)
}
fn encode<D: DesiredState>(snapshot: &Snapshot<D>) -> Result<Vec<u8>, StoreError> {
    let bytes = serde_saphyr::to_string(snapshot)
        .map_err(|_| StoreError::InvalidSnapshot)?
        .into_bytes();
    if bytes.len() > MAX_BYTES {
        return Err(StoreError::Capacity);
    }
    Ok(bytes)
}
fn decode<D: DesiredState>(bytes: &[u8]) -> Result<Snapshot<D>, StoreError> {
    if bytes.len() > MAX_BYTES {
        return Err(StoreError::Capacity);
    }
    let yaml = std::str::from_utf8(bytes).map_err(|_| StoreError::InvalidSnapshot)?;
    let options =
        serde_saphyr::options! { duplicate_keys: serde_saphyr::DuplicateKeyPolicy::Error };
    let snapshot: Snapshot<D> = serde_saphyr::from_str_with_options(yaml, options)
        .map_err(|_| StoreError::InvalidSnapshot)?;
    validate(&snapshot)?;
    Ok(snapshot)
}
fn validate<D: DesiredState>(snapshot: &Snapshot<D>) -> Result<(), StoreError> {
    use std::collections::BTreeSet;
    if ![1, SCHEMA].contains(&snapshot.schema_version) {
        return Err(StoreError::UnsupportedVersion(snapshot.schema_version));
    }
    if snapshot.installation_id.is_empty() || snapshot.cluster_id.is_empty() {
        return Err(StoreError::InvalidSnapshot);
    }
    bounded_records(&snapshot.records)?;
    let mut ids = BTreeSet::new();
    let mut services = BTreeSet::new();
    let mut names = BTreeSet::new();
    let mut targets = BTreeSet::new();
    let mut tokens = BTreeSet::new();
    let mut keys = BTreeSet::new();
    for record in &snapshot.records {
        if record.version != 1 {
            return Err(StoreError::UnsupportedVersion(record.version));
        }
        if record.id.is_empty() || record.generation == 0 || !ids.insert(&record.id) {
            return Err(StoreError::InvalidSnapshot);
        }
        let fields: Vec<&str> = match &record.data {
            RecordData::Reservation { service_id, name } => vec![service_id, name],
            RecordData::Approval {
                service_id,
                administrator,
                revision,
            } => vec![service_id, administrator, revision],
            RecordData::Desired {
                service_id,
                revision,
                digest,
                snapshot,
            } => {
                snapshot.validate()?;
                vec![service_id, revision, digest]
            }
            RecordData::Inventory {
                service_id,
                target,
                ownership_token,
                uid,
                ..
            } => {
                let mut fields = vec![service_id.as_str(), ownership_token];
                fields.extend(target.required_fields());
                if let Some(uid) = uid {
                    fields.push(uid);
                }
                fields
            }
            RecordData::Revision {
                service_id,
                revision,
                ..
            } => vec![service_id, revision],
            RecordData::Operation {
                service_id,
                intent,
                state,
            } => {
                if intent.desired_generation == 0 || !keys.insert(&intent.idempotency_key) {
                    return Err(StoreError::InvalidSnapshot);
                }
                let mut fields = vec![
                    service_id.as_str(),
                    &intent.target_record_id,
                    &intent.idempotency_key,
                ];
                if let OperationState::Failed { code } = state {
                    fields.push(code);
                }
                fields
            }
        };
        if fields.iter().any(|value| value.trim().is_empty()) {
            return Err(StoreError::InvalidSnapshot);
        }
        if let RecordData::Inventory {
            target,
            ownership_token,
            ..
        } = &record.data
            && (!targets.insert(target) || !tokens.insert(ownership_token))
        {
            return Err(StoreError::InvalidSnapshot);
        }
        if let RecordData::Reservation { service_id, name } = &record.data
            && (service_id != &record.id
                || name.is_empty()
                || !services.insert(service_id)
                || !names.insert(name))
        {
            return Err(StoreError::InvalidSnapshot);
        }
    }
    for record in &snapshot.records {
        if let RecordData::Operation { intent, .. } = &record.data
            && !ids.contains(&intent.target_record_id)
        {
            return Err(StoreError::InvalidSnapshot);
        }
        let service_id = match &record.data {
            RecordData::Reservation { service_id, .. }
            | RecordData::Approval { service_id, .. }
            | RecordData::Desired { service_id, .. }
            | RecordData::Inventory { service_id, .. }
            | RecordData::Revision { service_id, .. }
            | RecordData::Operation { service_id, .. } => service_id,
        };
        if !services.contains(service_id) {
            return Err(StoreError::InvalidSnapshot);
        }
    }
    Ok(())
}
fn bounded_records<D: DesiredState>(records: &[Record<D>]) -> Result<(), StoreError> {
    if records.len() > MAX_RECORDS {
        return Err(StoreError::Capacity);
    }
    // Metadata fields are identifiers/references, never document bodies or raw Git data.
    for record in records {
        let mut bytes = 0usize;
        let mut check = |value: &str| -> Result<(), StoreError> {
            bytes = bytes.checked_add(value.len()).ok_or(StoreError::Capacity)?;
            if value.len() > 4096 || bytes > 16 * 1024 {
                return Err(StoreError::Capacity);
            }
            Ok(())
        };
        check(&record.id)?;
        match &record.data {
            RecordData::Reservation { service_id, name } => {
                check(service_id)?;
                check(name)?;
            }
            RecordData::Approval {
                service_id,
                administrator,
                revision,
            } => {
                check(service_id)?;
                check(administrator)?;
                check(revision)?;
            }
            RecordData::Desired {
                service_id,
                revision,
                digest,
                snapshot: _,
            } => {
                check(service_id)?;
                check(revision)?;
                check(digest)?;
            }
            RecordData::Inventory {
                service_id,
                target,
                ownership_token,
                uid,
                ..
            } => {
                check(service_id)?;
                check(&target.api_group)?;
                for value in target.required_fields() {
                    check(value)?;
                }
                check(ownership_token)?;
                if let Some(uid) = uid {
                    check(uid)?;
                }
            }
            RecordData::Revision {
                service_id,
                revision,
                ..
            } => {
                check(service_id)?;
                check(revision)?;
            }
            RecordData::Operation {
                service_id,
                intent,
                state,
            } => {
                check(service_id)?;
                check(&intent.target_record_id)?;
                check(&intent.idempotency_key)?;
                if let OperationState::Failed { code } = state {
                    check(code)?;
                }
            }
        }
    }
    Ok(())
}
fn same_identity<D: DesiredState>(old: &RecordData<D>, new: &RecordData<D>) -> bool {
    match (old, new) {
        (RecordData::Reservation { .. }, RecordData::Reservation { .. })
        | (RecordData::Approval { .. }, RecordData::Approval { .. }) => old == new,
        (RecordData::Desired { service_id: a, .. }, RecordData::Desired { service_id: b, .. })
        | (
            RecordData::Revision { service_id: a, .. },
            RecordData::Revision { service_id: b, .. },
        ) => a == b,
        (
            RecordData::Operation {
                service_id: a,
                intent: ia,
                ..
            },
            RecordData::Operation {
                service_id: b,
                intent: ib,
                ..
            },
        ) => a == b && ia == ib,
        (
            RecordData::Inventory {
                service_id: a,
                target: ta,
                ownership_token: oa,
                uid: ua,
                lifecycle: la,
            },
            RecordData::Inventory {
                service_id: b,
                target: tb,
                ownership_token: ob,
                uid: ub,
                lifecycle: lb,
            },
        ) => a == b && ta == tb && oa == ob && la == lb && (ua.is_none() || ua == ub),
        _ => false,
    }
}
impl<D: DesiredState> Writer<D> {
    fn open(
        root: &Path,
        installation: &str,
        cluster: &str,
        fresh: bool,
    ) -> Result<Self, StoreError> {
        let root_file = File::from(
            open(
                root,
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(io)?,
        );
        let state_exists = root.join("_platform/state").symlink_metadata().is_ok();
        if !state_exists && !fresh {
            return Err(StoreError::RecoveryRequired);
        }
        if !state_exists {
            // A fresh installation may have host configuration, never managed data.
            for entry in std::fs::read_dir(root).map_err(io)? {
                if entry.map_err(io)?.file_name() != "_platform" {
                    return Err(StoreError::RecoveryRequired);
                }
            }
            if root.join("_platform").exists() {
                for entry in std::fs::read_dir(root.join("_platform")).map_err(io)? {
                    if !["config.yaml", "secrets.yaml"]
                        .iter()
                        .any(|name| entry.as_ref().is_ok_and(|entry| entry.file_name() == *name))
                    {
                        return Err(StoreError::RecoveryRequired);
                    }
                }
            }
        }
        let platform = directory(&root_file, "_platform", !state_exists)?;
        let directory = directory(&platform, "state", !state_exists)?;
        let lock = open_file(&directory, "controller.lock", OFlags::RDWR | OFlags::CREATE)?;
        flock(&lock, FlockOperation::NonBlockingLockExclusive).map_err(|error| {
            if error == rustix::io::Errno::WOULDBLOCK {
                StoreError::AlreadyRunning
            } else {
                io(error)
            }
        })?;
        let initial = Snapshot {
            schema_version: SCHEMA,
            generation: 0,
            installation_id: installation.into(),
            cluster_id: cluster.into(),
            records: vec![],
        };
        let bytes = match open_file(&directory, "controller.yaml", OFlags::RDONLY) {
            Ok(file) => {
                let mut bytes = vec![];
                file.take((MAX_BYTES + 1) as u64)
                    .read_to_end(&mut bytes)
                    .map_err(io)?;
                Some(bytes)
            }
            Err(StoreError::Io(std::io::ErrorKind::NotFound)) if !state_exists && fresh => None,
            Err(StoreError::Io(std::io::ErrorKind::NotFound)) => {
                return Err(StoreError::RecoveryRequired);
            }
            Err(error) => return Err(error),
        };
        let current = match &bytes {
            Some(bytes) => decode(bytes)?,
            None => initial,
        };
        validate(&current)?;
        if current.installation_id != installation || current.cluster_id != cluster {
            return Err(StoreError::BindingMismatch);
        }
        let mut writer = Self {
            directory,
            _lock: lock,
            current: Arc::new(current),
            halted: false,
            sequence: 0,
            #[cfg(test)]
            fault: None,
        };
        if bytes.is_none() {
            writer.persist(&writer.current.clone())?;
        }
        if writer.current.schema_version == 1 {
            let backup = format!("controller-v1-{}.backup.yaml", writer.current.generation);
            let bytes = encode(&writer.current)?;
            // Validate the exact backup bytes before committing the backup entry.
            decode::<D>(&bytes)?;
            let file = open_file(
                &writer.directory,
                &backup,
                OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL,
            );
            match file {
                Ok(mut file) => {
                    file.write_all(&bytes).map_err(io)?;
                    file.flush().map_err(io)?;
                    file.sync_all().map_err(io)?;
                }
                Err(StoreError::Io(std::io::ErrorKind::AlreadyExists)) => {
                    let file = open_file(&writer.directory, &backup, OFlags::RDONLY)?;
                    let mut saved = Vec::new();
                    (&file)
                        .take((MAX_BYTES + 1) as u64)
                        .read_to_end(&mut saved)
                        .map_err(io)?;
                    if decode::<D>(&saved)? != *writer.current {
                        return Err(StoreError::RecoveryRequired);
                    }
                    file.sync_all().map_err(io)?;
                }
                Err(error) => return Err(error),
            }
            writer.directory.sync_all().map_err(io)?;
            let migrated = Arc::new(Snapshot {
                schema_version: SCHEMA,
                generation: writer
                    .current
                    .generation
                    .checked_add(1)
                    .ok_or(StoreError::Capacity)?,
                ..(*writer.current).clone()
            });
            validate(&migrated)?;
            writer.persist(&migrated)?;
            writer.current = migrated;
        }
        // The committed path is now validated; abandoned temporaries have no authority.
        for entry in rustix::fs::Dir::read_from(&writer.directory).map_err(io)? {
            let entry = entry.map_err(io)?;
            let name = entry.file_name().to_bytes();
            if name.starts_with(b".controller-") && name.ends_with(b".tmp") {
                unlinkat(&writer.directory, entry.file_name(), AtFlags::empty()).map_err(io)?;
            }
        }
        Ok(writer)
    }
    fn commit(
        &mut self,
        expected: u64,
        records: Vec<Record<D>>,
    ) -> Result<Arc<Snapshot<D>>, StoreError> {
        if self.halted {
            return Err(StoreError::Halted);
        }
        if self.current.generation != expected {
            return Err(StoreError::StaleGeneration);
        }
        if records.len() > MAX_RECORDS {
            return Err(StoreError::Capacity);
        }
        for record in &records {
            if let Some(old) = self.current.records.iter().find(|old| old.id == record.id) {
                if record != old && old.generation.checked_add(1) != Some(record.generation) {
                    return Err(StoreError::StaleGeneration);
                }
                if !same_identity(&old.data, &record.data) {
                    return Err(StoreError::InvalidSnapshot);
                }
            } else if record.generation != 1 {
                return Err(StoreError::StaleGeneration);
            }
        }
        // Retained metadata and operation identities cannot disappear through replacement.
        if self
            .current
            .records
            .iter()
            .any(|old| !records.iter().any(|record| record.id == old.id))
        {
            return Err(StoreError::InvalidSnapshot);
        }
        let next = Arc::new(Snapshot {
            generation: expected.checked_add(1).ok_or(StoreError::Capacity)?,
            records,
            ..(*self.current).clone()
        });
        validate(&next)?;
        if let Err(error) = self.persist(&next) {
            if !matches!(error, StoreError::Capacity | StoreError::InvalidSnapshot) {
                self.halted = true;
            }
            return Err(error);
        }
        self.current = next.clone();
        tracing::debug!(
            generation = next.generation,
            schema_version = next.schema_version,
            "controller metadata committed"
        );
        Ok(next)
    }
    fn persist(&mut self, next: &Snapshot<D>) -> Result<(), StoreError> {
        let bytes = encode(next)?;
        self.sequence = self.sequence.checked_add(1).ok_or(StoreError::Capacity)?;
        let name = format!(".controller-{}-{}.tmp", std::process::id(), self.sequence);
        let mut created = false;
        let result = (|| {
            let mut file = open_file(
                &self.directory,
                &name,
                OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL,
            )?;
            created = true;
            #[cfg(test)]
            if self.fault == Some(Fault::Write) {
                file.write_all(&bytes[..bytes.len() / 2]).map_err(io)?;
                return Err(io(std::io::Error::from_raw_os_error(28)));
            }
            file.write_all(&bytes).map_err(io)?;
            file.flush().map_err(io)?;
            #[cfg(test)]
            if self.fault == Some(Fault::FileSync) {
                return Err(StoreError::Io(std::io::ErrorKind::Other));
            }
            file.sync_all().map_err(io)?;
            #[cfg(test)]
            if self.fault == Some(Fault::Rename) {
                return Err(StoreError::Io(std::io::ErrorKind::PermissionDenied));
            }
            renameat(&self.directory, &name, &self.directory, "controller.yaml").map_err(io)?;
            #[cfg(test)]
            if self.fault == Some(Fault::DirectorySync) {
                self.halted = true;
                return Err(StoreError::IndeterminateCommit);
            }
            if self.directory.sync_all().is_err() {
                self.halted = true;
                return Err(StoreError::IndeterminateCommit);
            }
            #[cfg(test)]
            if self.fault == Some(Fault::LostResponse) {
                self.halted = true;
                return Err(StoreError::IndeterminateCommit);
            }
            Ok(())
        })();
        if result.is_err() && created {
            let _ = unlinkat(&self.directory, &name, AtFlags::empty());
        }
        result
    }
}

#[cfg(test)]
mod tests;
