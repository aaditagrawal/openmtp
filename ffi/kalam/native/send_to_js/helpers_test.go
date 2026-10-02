//go:build openmtp_manual

package send_to_js

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"testing"
)

func TestEncodingFailureReturnsParseableError(t *testing.T) {
	var result Result
	if err := json.Unmarshal([]byte(toJson(math.NaN())), &result); err != nil {
		t.Fatal(err)
	}
	if result.Error == "" {
		t.Fatal("encoding failure lost")
	}
}

func TestNativeDetectionAndSetupErrorsKeepTheirTypes(t *testing.T) {
	for _, item := range []struct {
		message string
		kind    ErrorType
	}{
		{"ErrorMtpDetectFailed: no MTP devices found", ErrorMtpDetectFailed},
		{"ErrorDeviceSetup: interface busy", ErrorDeviceSetup},
	} {
		kind, message := processError(fmt.Errorf("%s", item.message))
		if kind != item.kind || message != item.message {
			t.Fatalf("wrong classification %v %s", kind, message)
		}
	}
}

func TestIncompleteProgressDoesNotPanic(t *testing.T) {
	// Nil callback pointer is explicitly ignored by the C bridge.
	SendTransferFilesProgress(nil, nil)
	SendUploadFilesPreprocess(nil, nil, "")
	SendDownloadFilesPreprocess(nil, nil)
}

func TestMain(m *testing.M) {
	if os.Getenv("CI") != "" {
		panic("Native tests are local-only")
	}
	os.Exit(m.Run())
}
