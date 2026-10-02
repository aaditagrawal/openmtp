package send_to_js

import (
	"github.com/ganeshrvel/go-mtpfs/mtp"
	"github.com/ganeshrvel/go-mtpx"
)

type ErrorType string

type FileInfo struct {
	Size      int64  `json:"size"`
	IsDir     bool   `json:"isFolder"`
	ModTime   string `json:"dateAdded"`
	Name      string `json:"name"`
	FullPath  string `json:"path"`
	Extension string `json:"extension"`
}

type FileExistsData struct {
	Fullpath string `json:"fullpath"`
	Exists   bool   `json:"exists"`
}

type TransferPreprocessData struct {
	FullPath string `json:"fullPath"`
	Name     string `json:"name"`
	Size     int64  `json:"size"`
}

type TransferSizeInfo struct {
	// total size to transfer
	// note: the value will be 0 if pre-processing was not allowed
	Total int64 `json:"total"`

	// total size transferred
	Sent int64 `json:"sent"`

	// progress in percentage
	Progress float32 `json:"progress"`
}

type TransferProgressInfo struct {
	FullPath string `json:"fullPath"`

	Name string `json:"name"`

	ElapsedTime int64 `json:"elapsedTime"`

	// transfer rate (in MB/s)
	Speed float64 `json:"speed"`

	// total files to transfer
	// note: the value will be 0 if pre-processing was not allowed
	TotalFiles int64 `json:"totalFiles"`

	// total directories to transfer
	// note: the value will be 0 if pre-processing was not allowed
	TotalDirectories int64 `json:"totalDirectories"`

	// total files transferred
	FilesSent int64 `json:"filesSent"`

	// total file transfer progress in percentage
	FilesSentProgress float32 `json:"filesSentProgress"`

	// size information of the current file which is being transferred
	ActiveFileSize TransferSizeInfo `json:"activeFileSize"`

	// total size information of the files for the transfer session
	BulkFileSize TransferSizeInfo `json:"bulkFileSize"`

	Status mtpx.TransferStatus `json:"status"`
}

type DeviceInfo struct {
	MtpDeviceInfo *mtp.DeviceInfo    `json:"mtpDeviceInfo"`
	UsbDeviceInfo *mtp.UsbDeviceInfo `json:"usbDeviceInfo"`
}

// Result preserves the wire envelope for every callback. A typed nil slice
// still marshals as null, matching older clients and packaged native libraries.
type Result struct {
	ErrorType ErrorType   `json:"errorType"`
	Error     string      `json:"error"`
	Data      interface{} `json:"data"`
}

func NewFileInfo(file *mtpx.FileInfo) FileInfo {
	return FileInfo{
		Size: file.Size, IsDir: file.IsDir,
		// DateTimeFormat ends in a literal Z, so normalize the instant first.
		ModTime: file.ModTime.UTC().Format(DateTimeFormat),
		Name:    file.Name, FullPath: file.FullPath, Extension: file.Extension,
	}
}
