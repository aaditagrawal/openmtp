package send_to_js

/*
	#include "stdio.h"
	#include "stdlib.h"
	#include "stdbool.h"

	typedef void (* on_cb_result_t)(char*);
	void send_cb_result(on_cb_result_t* ptr, char* json) {
		on_cb_result_t cb = (on_cb_result_t) ptr;

		if(cb != 0 && cb != NULL){
			cb(json);
		}
	}
*/
import "C"
import (
	"fmt"
	"os"
	"time"
	"unsafe"

	"github.com/ganeshrvel/go-mtpfs/mtp"
	"github.com/ganeshrvel/go-mtpx"
)

type SendCbResult C.on_cb_result_t

// sendJson copies json into C memory, invokes the JS callback synchronously,
// then frees the C string. koffi/JSON.parse copy the bytes before return.
func sendJson(onDonePtr *SendCbResult, json string) {
	cstr := C.CString(json)
	defer C.free(unsafe.Pointer(cstr))

	convertedDoneCbPtr := (*C.on_cb_result_t)(onDonePtr)
	C.send_cb_result(convertedDoneCbPtr, cstr)
}

func SendError(onDonePtr *SendCbResult, err error) {
	errorType, errorMsg := processError(err)

	o := Result{
		ErrorType: errorType,
		Error:     errorMsg,
		Data:      nil,
	}

	sendJson(onDonePtr, toJson(o))
}

func SendInitialize(onDonePtr *SendCbResult, deviceInfo *mtp.DeviceInfo, usbDesc *mtp.UsbDeviceInfo) {
	o := Result{
		Data: DeviceInfo{
			MtpDeviceInfo: deviceInfo,
			UsbDeviceInfo: usbDesc,
		},
	}

	sendJson(onDonePtr, toJson(o))
}

func SendStorages(onDonePtr *SendCbResult, storages []mtpx.StorageData) {
	o := Result{
		Data: storages,
	}

	sendJson(onDonePtr, toJson(o))
}

func SendFileExists(onDonePtr *SendCbResult, fc []mtpx.FileExistsContainer, inputFiles []string) {
	var fdSlice []FileExistsData
	for i, f := range fc {
		fd := FileExistsData{
			Fullpath: inputFiles[i],
			Exists:   f.Exists,
		}

		fdSlice = append(fdSlice, fd)
	}

	o := Result{
		Data: fdSlice,
	}

	sendJson(onDonePtr, toJson(o))
}

func SendWalk(onDonePtr *SendCbResult, files []FileInfo) {
	sendJson(onDonePtr, toJson(Result{Data: files}))
}

func SendUploadFilesPreprocess(onDonePtr *SendCbResult, fi *os.FileInfo, fullPath string) {
	if fi == nil || *fi == nil {
		SendError(onDonePtr, fmt.Errorf("missing upload file information"))
		return
	}
	o := Result{
		Data: TransferPreprocessData{
			FullPath: fullPath,
			Name:     (*fi).Name(),
			Size:     (*fi).Size(),
		},
	}

	sendJson(onDonePtr, toJson(o))
}

func SendDownloadFilesPreprocess(onDonePtr *SendCbResult, fi *mtpx.FileInfo) {
	if fi == nil {
		SendError(onDonePtr, fmt.Errorf("missing download file information"))
		return
	}
	o := Result{
		Data: TransferPreprocessData{
			FullPath: fi.FullPath,
			Name:     fi.Name,
			Size:     fi.Size,
		},
	}

	sendJson(onDonePtr, toJson(o))
}

func SendTransferFilesProgress(onDonePtr *SendCbResult, p *mtpx.ProgressInfo) {
	if p == nil || p.FileInfo == nil || p.ActiveFileSize == nil || p.BulkFileSize == nil {
		SendError(onDonePtr, fmt.Errorf("incomplete native transfer progress"))
		return
	}
	o := Result{
		Data: TransferProgressInfo{
			FullPath:          p.FileInfo.FullPath,
			Name:              p.FileInfo.Name,
			ElapsedTime:       time.Since(p.StartTime).Milliseconds(),
			Speed:             p.Speed,
			TotalFiles:        p.TotalFiles,
			TotalDirectories:  p.TotalDirectories,
			FilesSent:         p.FilesSent,
			FilesSentProgress: p.FilesSentProgress,
			ActiveFileSize: TransferSizeInfo{
				Total:    p.ActiveFileSize.Total,
				Sent:     p.ActiveFileSize.Sent,
				Progress: p.ActiveFileSize.Progress,
			},
			BulkFileSize: TransferSizeInfo{
				Total:    p.BulkFileSize.Total,
				Sent:     p.BulkFileSize.Sent,
				Progress: p.BulkFileSize.Progress,
			},
			Status: p.Status,
		},
	}

	sendJson(onDonePtr, toJson(o))
}

func SendSuccess(onDonePtr *SendCbResult) {
	sendJson(onDonePtr, toJson(Result{Data: true}))
}
