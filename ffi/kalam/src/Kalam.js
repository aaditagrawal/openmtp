import koffi from 'koffi';
import { kalamLibPath } from '../../../app/helpers/binaries';
import { log } from '../../../app/utils/log';
import { trace } from '../../../app/utils/diagnostics';
import { NativeInvoker, nativeErrorResult } from './NativeInvoker';

let callbackType;
import { checkIf } from '../../../app/utils/checkIf';
import { FILE_TRANSFER_DIRECTION } from '../../../app/enums';

export class Kalam {
  constructor() {
    this.libPath = kalamLibPath;
    this.lib = koffi.load(this.libPath);

    callbackType ||= koffi.proto('void on_cb_result_t(char*)');

    this.fnDictionary = Object.freeze({
      Initialize: 'void Initialize(on_cb_result_t* onDonePtr)',
      FetchDeviceInfo: 'void FetchDeviceInfo(on_cb_result_t* onDonePtr)',
      FetchStorages: 'void FetchStorages(on_cb_result_t* onDonePtr)',
      FileExists:
        'void FileExists(char* fileExistsInputJson, on_cb_result_t* onDonePtr)',
      DeleteFile:
        'void DeleteFile(char* deleteFileInputJson, on_cb_result_t* onDonePtr)',
      MakeDirectory:
        'void MakeDirectory(char* makeDirectoryInputJson, on_cb_result_t* onDonePtr)',
      RenameFile:
        'void RenameFile(char* renameFileInputJson, on_cb_result_t* onDonePtr)',
      Walk: 'void Walk(char* walkInputJson, on_cb_result_t* onDonePtr)',
      DownloadFiles:
        'void DownloadFiles(char* downloadFilesInputJson, on_cb_result_t* onPreprocessPtr, on_cb_result_t* onProgressPtr, on_cb_result_t* onDonePtr)',
      UploadFiles:
        'void UploadFiles(char* uploadFilesInputJson, on_cb_result_t* onPreprocessPtr, on_cb_result_t* onProgressPtr, on_cb_result_t* onDonePtr)',
      Dispose: 'void Dispose(on_cb_result_t* onDonePtr)',
    });

    // Bind once — koffi.func parsing on every Walk/transfer was pure overhead.
    this.fns = Object.freeze({
      Initialize: this.lib.func(this.fnDictionary.Initialize),
      FetchDeviceInfo: this.lib.func(this.fnDictionary.FetchDeviceInfo),
      FetchStorages: this.lib.func(this.fnDictionary.FetchStorages),
      FileExists: this.lib.func(this.fnDictionary.FileExists),
      DeleteFile: this.lib.func(this.fnDictionary.DeleteFile),
      MakeDirectory: this.lib.func(this.fnDictionary.MakeDirectory),
      RenameFile: this.lib.func(this.fnDictionary.RenameFile),
      Walk: this.lib.func(this.fnDictionary.Walk),
      DownloadFiles: this.lib.func(this.fnDictionary.DownloadFiles),
      UploadFiles: this.lib.func(this.fnDictionary.UploadFiles),
      Dispose: this.lib.func(this.fnDictionary.Dispose),
    });
    this.invoker = new NativeInvoker({
      ffi: koffi,
      callbackType,
      functions: this.fns,
      reportError: (error, title) => log.error(error, title),
      trace,
    });
  }

  initialize() {
    return this.invoker.invoke('Initialize');
  }
  fetchDeviceInfo() {
    return this.invoker.invoke('FetchDeviceInfo');
  }
  listStorages() {
    return this.invoker.invoke('FetchStorages');
  }
  dispose() {
    return this.invoker.invoke('Dispose');
  }

  makeDirectory({ storageId, fullPath }) {
    checkIf(storageId, 'number');
    checkIf(fullPath, 'string');
    return this.invoker.invoke('MakeDirectory', [
      JSON.stringify({ storageId: parseInt(storageId, 10), fullPath }),
    ]);
  }

  fileExist({ storageId, files }) {
    checkIf(storageId, 'number');
    checkIf(files, 'array');
    return this.invoker.invoke('FileExists', [
      JSON.stringify({ storageId: parseInt(storageId, 10), files }),
    ]);
  }

  deleteFile({ storageId, files }) {
    checkIf(storageId, 'number');
    checkIf(files, 'array');
    return this.invoker.invoke('DeleteFile', [
      JSON.stringify({ storageId: parseInt(storageId, 10), files }),
    ]);
  }

  renameFile({ storageId, fullPath, newFilename }) {
    checkIf(storageId, 'number');
    checkIf(fullPath, 'string');
    checkIf(newFilename, 'string');
    return this.invoker.invoke('RenameFile', [
      JSON.stringify({
        storageId: parseInt(storageId, 10),
        fullPath,
        newFileName: newFilename,
      }),
    ]);
  }

  walk({ storageId, fullPath, skipHiddenFiles, recursive = false }) {
    checkIf(storageId, 'number');
    checkIf(fullPath, 'string');
    checkIf(skipHiddenFiles, 'boolean');
    return this.invoker.invoke('Walk', [
      JSON.stringify({
        storageId: parseInt(storageId, 10),
        fullPath,
        skipHiddenFiles,
        recursive,
        skipDisallowedFiles: false,
      }),
    ]);
  }

  async transferFiles({
    direction,
    storageId,
    sources,
    destination,
    preprocessFiles,
    onError,
    onPreprocess,
    onProgress,
    onCompleted,
  }) {
    checkIf(direction, 'string');
    checkIf(storageId, 'number');
    checkIf(sources, 'array');
    checkIf(destination, 'string');
    checkIf(preprocessFiles, 'boolean');
    checkIf(onError, 'function');
    checkIf(onPreprocess, 'function');
    checkIf(onProgress, 'function');
    checkIf(onCompleted, 'function');
    const name =
      direction === FILE_TRANSFER_DIRECTION.upload
        ? 'UploadFiles'
        : direction === FILE_TRANSFER_DIRECTION.download
          ? 'DownloadFiles'
          : null;
    if (!name)
      return nativeErrorResult(new Error('Unsupported MTP transfer direction'));
    const progress = (handler) => (result) => {
      if (result.error || result.stderr) {
        onError(result);
        throw new Error(result.error || result.stderr);
      }
      if (result.data) handler(result.data);
    };
    return this.invoker.invoke(
      name,
      [
        JSON.stringify({
          storageId: parseInt(storageId, 10),
          sources,
          destination,
          preprocessFiles,
        }),
      ],
      {
        callbacks: [progress(onPreprocess), progress(onProgress)],
        onCompleted: () => onCompleted(),
      },
    );
  }
}
