import { createGzip } from 'zlib';
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { log } from './log';

export const compressFile = async (_input, _output) => {
  try {
    await pipeline(
      createReadStream(_input),
      createGzip(),
      createWriteStream(_output),
    );
    return true;
  } catch (e) {
    log.error(e, `gzip -> compressFile`);
    return false;
  }
};
