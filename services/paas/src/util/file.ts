import fs from 'fs/promises';
import fsSync from 'fs';

export const writeFile = async (name: string, data: string) => {
  await fs.writeFile(name, data);
};

export const readFile = async (name: string) => {
  try {
    return await fs.readFile(name, 'utf-8');
  } catch {
    return undefined;
  }
};

export const readFileSync = (name: string) => {
  try {
    return fsSync.readFileSync(name, { encoding: 'utf-8' });
  } catch {
    return undefined;
  }
};
