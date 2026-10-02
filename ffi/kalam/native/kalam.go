package main

import (
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"encoding/json"
	"github.com/ganeshrvel/go-mtpx"
	"kalam/send_to_js"
)

/*	#include "stdint.h"
	typedef void (* on_cb_result_t)(char*);
*/
import "C"

var container deviceContainer

//export Initialize
func Initialize(onDonePtr *C.on_cb_result_t) {
	sendToJsOnDonePtr := (*send_to_js.SendCbResult)(onDonePtr)

	if err := lockMtp(); err != nil {
		send_to_js.SendError(sendToJsOnDonePtr, err)

		return
	}
	defer unlockMtp()
	defer recoverMtpPanic(sendToJsOnDonePtr)

	_, err := _initialize(mtpx.Init{DebugMode: os.Getenv("OPENMTP_NATIVE_DEBUG") == "1"})
	if err != nil {
		send_to_js.SendError(sendToJsOnDonePtr, err)

		return
	}

	dInfo, err := _fetchDeviceInfo()
	if err != nil {
		_ = _dispose()
		send_to_js.SendError(sendToJsOnDonePtr, err)

		return
	}

	usbDesc, err := container.dev.GetUsbInfo()
	if err != nil {
		_ = _dispose()
		send_to_js.SendError(sendToJsOnDonePtr, err)

		return
	}

	send_to_js.SendInitialize(sendToJsOnDonePtr, dInfo, usbDesc)
}

//export FetchDeviceInfo
func FetchDeviceInfo(onDonePtr *C.on_cb_result_t) {
	sendToJsOnDonePtr := (*send_to_js.SendCbResult)(onDonePtr)

	if err := lockMtp(); err != nil {
		send_to_js.SendError(sendToJsOnDonePtr, err)

		return
	}
	defer unlockMtp()
	defer recoverMtpPanic(sendToJsOnDonePtr)

	dInfo, err := _fetchDeviceInfo()
	if err != nil {
		send_to_js.SendError(sendToJsOnDonePtr, err)

		return
	}

	usbDesc, err := container.dev.GetUsbInfo()
	if err != nil {
		send_to_js.SendError(sendToJsOnDonePtr, err)

		return
	}

	send_to_js.SendInitialize(sendToJsOnDonePtr, dInfo, usbDesc)
}

//export FetchStorages
func FetchStorages(onDonePtr *C.on_cb_result_t) {
	sendToJsOnDonePtr := (*send_to_js.SendCbResult)(onDonePtr)

	if err := lockMtp(); err != nil {
		send_to_js.SendError(sendToJsOnDonePtr, err)

		return
	}
	defer unlockMtp()
	defer recoverMtpPanic(sendToJsOnDonePtr)

	_sendFetchStorages(true, sendToJsOnDonePtr)
}

func _sendFetchStorages(retry bool, onDonePtr *send_to_js.SendCbResult) {
	storages, err := _fetchStorages()

	if err != nil {
		if container.dev != nil && container.deviceInfo != nil {
			if strings.Contains(err.Error(), "EOF") {
				err = fmt.Errorf("error allow storage access. %+v", err.Error())

				// this is done to prevent samsung devices from returning usb timeouts
				_ = _dispose()
			}
		}

		send_to_js.SendError(onDonePtr, err)

		return
	}

	send_to_js.SendStorages(onDonePtr, storages)
}

//export MakeDirectory
func MakeDirectory(makeDirectoryInputJson *C.char, onDonePtr *C.on_cb_result_t) {
	sendToJsOnDonePtr := (*send_to_js.SendCbResult)(onDonePtr)

	if err := lockMtp(); err != nil {
		send_to_js.SendError(sendToJsOnDonePtr, err)

		return
	}
	defer unlockMtp()
	defer recoverMtpPanic(sendToJsOnDonePtr)

	i := MakeDirectoryInput{}

	err := json.Unmarshal([]byte(C.GoString(makeDirectoryInputJson)), &i)
	if err != nil {
		send_to_js.SendError(sendToJsOnDonePtr, fmt.Errorf("error occured while Unmarshalling MakeDirectory input data %+v: ", err))

		return
	}

	if err := _makeDirectory(i.StorageId, i.FullPath); err != nil {
		send_to_js.SendError(sendToJsOnDonePtr, err)

		return
	}

	send_to_js.SendSuccess(sendToJsOnDonePtr)
}

//export FileExists
func FileExists(fileExistsInputJson *C.char, onDonePtr *C.on_cb_result_t) {
	sendToJsOnDonePtr := (*send_to_js.SendCbResult)(onDonePtr)

	if err := lockMtp(); err != nil {
		send_to_js.SendError(sendToJsOnDonePtr, err)

		return
	}
	defer unlockMtp()
	defer recoverMtpPanic(sendToJsOnDonePtr)

	i := FileExistsInput{}

	err := json.Unmarshal([]byte(C.GoString(fileExistsInputJson)), &i)
	if err != nil {
		send_to_js.SendError(sendToJsOnDonePtr, fmt.Errorf("error occured while Unmarshalling FileExists input data %+v: ", err))

		return
	}

	var fProps []mtpx.FileProp
	for _, f := range i.Files {
		fProp := mtpx.FileProp{FullPath: f}

		fProps = append(fProps, fProp)
	}

	fc, err := _fileExists(i.StorageId, fProps)
	if err != nil {
		send_to_js.SendError(sendToJsOnDonePtr, err)

		return
	}

	send_to_js.SendFileExists(sendToJsOnDonePtr, fc, i.Files)
}

//export DeleteFile
func DeleteFile(deleteFileInputJson *C.char, onDonePtr *C.on_cb_result_t) {
	sendToJsOnDonePtr := (*send_to_js.SendCbResult)(onDonePtr)

	if err := lockMtp(); err != nil {
		send_to_js.SendError(sendToJsOnDonePtr, err)

		return
	}
	defer unlockMtp()
	defer recoverMtpPanic(sendToJsOnDonePtr)

	i := DeleteFileInput{}

	err := json.Unmarshal([]byte(C.GoString(deleteFileInputJson)), &i)
	if err != nil {
		send_to_js.SendError(sendToJsOnDonePtr, fmt.Errorf("error occured while Unmarshalling DeleteFile input data %+v: ", err))

		return
	}

	var fProps []mtpx.FileProp
	for _, f := range i.Files {
		fProp := mtpx.FileProp{FullPath: f}

		fProps = append(fProps, fProp)
	}

	err = _deleteFile(i.StorageId, fProps)
	if err != nil {
		send_to_js.SendError(sendToJsOnDonePtr, err)

		return
	}

	send_to_js.SendSuccess(sendToJsOnDonePtr)
}

//export RenameFile
func RenameFile(renameFileInputJson *C.char, onDonePtr *C.on_cb_result_t) {
	sendToJsOnDonePtr := (*send_to_js.SendCbResult)(onDonePtr)

	if err := lockMtp(); err != nil {
		send_to_js.SendError(sendToJsOnDonePtr, err)

		return
	}
	defer unlockMtp()
	defer recoverMtpPanic(sendToJsOnDonePtr)

	i := RenameFileInput{}

	err := json.Unmarshal([]byte(C.GoString(renameFileInputJson)), &i)
	if err != nil {
		send_to_js.SendError(sendToJsOnDonePtr, fmt.Errorf("error occured while Unmarshalling RenameFile input data %+v: ", err))

		return
	}

	var fProp = mtpx.FileProp{
		FullPath: i.FullPath,
	}

	err = _renameFile(i.StorageId, fProp, i.NewFileName)
	if err != nil {
		send_to_js.SendError(sendToJsOnDonePtr, err)

		return
	}

	send_to_js.SendSuccess(sendToJsOnDonePtr)
}

//export Walk
func Walk(walkInputJson *C.char, onDonePtr *C.on_cb_result_t) {
	sendToJsOnDonePtr := (*send_to_js.SendCbResult)(onDonePtr)

	if err := lockMtp(); err != nil {
		send_to_js.SendError(sendToJsOnDonePtr, err)

		return
	}
	defer unlockMtp()
	defer recoverMtpPanic(sendToJsOnDonePtr)

	i := WalkInput{}

	err := json.Unmarshal([]byte(C.GoString(walkInputJson)), &i)
	if err != nil {
		send_to_js.SendError(sendToJsOnDonePtr, fmt.Errorf("error occured while Unmarshalling Walk input data %+v: ", err))

		return
	}

	files, err := _walk(i.StorageId, i.FullPath, i.Recursive, i.SkipDisallowedFiles, i.SkipHiddenFiles)
	if err != nil {
		send_to_js.SendError(sendToJsOnDonePtr, err)

		return
	}

	send_to_js.SendWalk(sendToJsOnDonePtr, files)
}

//export UploadFiles
func UploadFiles(uploadFilesInputJson *C.char, onPreprocessPtr, onProgressPtr, onDonePtr *C.on_cb_result_t) {
	sendToJsOnPreprocessPtr := (*send_to_js.SendCbResult)(onPreprocessPtr)
	sendToJsOnProgressPtr := (*send_to_js.SendCbResult)(onProgressPtr)
	sendToJsOnDonePtr := (*send_to_js.SendCbResult)(onDonePtr)

	if err := lockMtp(); err != nil {
		send_to_js.SendError(sendToJsOnDonePtr, err)

		return
	}
	defer unlockMtp()
	defer recoverMtpPanic(sendToJsOnDonePtr)

	i := UploadFilesInput{}

	err := json.Unmarshal([]byte(C.GoString(uploadFilesInputJson)), &i)
	if err != nil {
		send_to_js.SendError(sendToJsOnDonePtr, fmt.Errorf("error occured while Unmarshalling UploadFiles input data %+v: ", err))

		return
	}

	var (
		pMu        sync.Mutex
		pInterface interface{}
	)

	setProgress := func(v interface{}) {
		pMu.Lock()
		pInterface = v
		pMu.Unlock()
	}

	stopProgress := startProgressPump(time.Millisecond*100, func() {
		pMu.Lock()
		pending := pInterface
		pInterface = nil
		pMu.Unlock()

		if pending == nil {
			return
		}

		switch v := pending.(type) {
		case UploadPreprocessContainer:
			send_to_js.SendUploadFilesPreprocess(sendToJsOnPreprocessPtr, v.fi, v.fullPath)

		case ProgressContainer:
			send_to_js.SendTransferFilesProgress(sendToJsOnProgressPtr, v.pInfo)

		default:
			log.Panicln("unimplemented UploadFiles.pInterface type")
		}
	})
	defer stopProgress()

	err = _uploadFiles(i.StorageId, i.Sources, i.Destination, i.PreprocessFiles,
		func(fi *os.FileInfo, fullPath string, err error) error {
			if err != nil {
				return err
			}

			setProgress(UploadPreprocessContainer{
				fi:       fi,
				fullPath: fullPath,
			})

			return nil
		},
		func(p *mtpx.ProgressInfo, err error) error {
			if err != nil {
				return err
			}

			setProgress(ProgressContainer{
				pInfo: cloneProgressInfo(p),
			})

			return nil
		})
	// Stop before done/error so the JS bridge never sees progress after completion.
	stopProgress()

	if err != nil {
		send_to_js.SendError(sendToJsOnDonePtr, err)

		return
	}

	send_to_js.SendSuccess(sendToJsOnDonePtr)
}

//export DownloadFiles
func DownloadFiles(downloadFilesInputJson *C.char, onPreprocessPtr, onProgressPtr, onDonePtr *C.on_cb_result_t) {
	sendToJsOnPreprocessPtr := (*send_to_js.SendCbResult)(onPreprocessPtr)
	sendToJsOnProgressPtr := (*send_to_js.SendCbResult)(onProgressPtr)
	sendToJsOnDonePtr := (*send_to_js.SendCbResult)(onDonePtr)

	if err := lockMtp(); err != nil {
		send_to_js.SendError(sendToJsOnDonePtr, err)

		return
	}
	defer unlockMtp()
	defer recoverMtpPanic(sendToJsOnDonePtr)

	i := DownloadFilesInput{}

	err := json.Unmarshal([]byte(C.GoString(downloadFilesInputJson)), &i)
	if err != nil {
		send_to_js.SendError(sendToJsOnDonePtr, fmt.Errorf("error occured while Unmarshalling DownloadFiles input data %+v: ", err))

		return
	}

	var (
		pMu        sync.Mutex
		pInterface interface{}
	)

	setProgress := func(v interface{}) {
		pMu.Lock()
		pInterface = v
		pMu.Unlock()
	}

	stopProgress := startProgressPump(time.Millisecond*100, func() {
		pMu.Lock()
		pending := pInterface
		pInterface = nil
		pMu.Unlock()

		if pending == nil {
			return
		}

		switch v := pending.(type) {
		case DownloadPreprocessContainer:
			send_to_js.SendDownloadFilesPreprocess(sendToJsOnPreprocessPtr, v.fi)

		case ProgressContainer:
			send_to_js.SendTransferFilesProgress(sendToJsOnProgressPtr, v.pInfo)

		default:
			log.Panicln("unimplemented DownloadFiles.pInterface type")
		}
	})
	defer stopProgress()

	err = _downloadFiles(i.StorageId, i.Sources, i.Destination, i.PreprocessFiles,
		func(fi *mtpx.FileInfo, err error) error {
			if err != nil {
				return err
			}

			setProgress(DownloadPreprocessContainer{
				fi: fi,
			})

			return nil
		},
		func(p *mtpx.ProgressInfo, err error) error {
			if err != nil {
				return err
			}

			setProgress(ProgressContainer{
				pInfo: cloneProgressInfo(p),
			})

			return nil
		})
	// Stop before done/error so the JS bridge never sees progress after completion.
	stopProgress()

	if err != nil {
		send_to_js.SendError(sendToJsOnDonePtr, err)

		return
	}

	send_to_js.SendSuccess(sendToJsOnDonePtr)
}

//export Dispose
func Dispose(onDonePtr *C.on_cb_result_t) {
	sendToJsOnDonePtr := (*send_to_js.SendCbResult)(onDonePtr)

	if err := lockMtp(); err != nil {
		send_to_js.SendError(sendToJsOnDonePtr, err)

		return
	}
	defer unlockMtp()
	defer recoverMtpPanic(sendToJsOnDonePtr)

	if err := _dispose(); err != nil {
		send_to_js.SendError(sendToJsOnDonePtr, err)

		return
	}

	container.dev = nil
	container.deviceInfo = nil

	send_to_js.SendSuccess(sendToJsOnDonePtr)
}

func main() {}
