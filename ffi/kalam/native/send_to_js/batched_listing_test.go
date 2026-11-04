package send_to_js

import (
	"errors"
	"testing"
)

func TestDirectoryListingErrorCategory(t *testing.T) {
	for _, tc := range []struct {
		message string
		want    ErrorType
	}{
		{"USB read failed", ErrorListDirectory},
		{"StoreNotAvailable", ErrorNoStorage},
		{"device is not open", ErrorDeviceLocked},
		{"allow storage access", ErrorAllowStorageAccess},
	} {
		cause := errors.New(tc.message)
		err := DirectoryListingError{Cause: cause}
		kind, message := processError(err)
		if kind != tc.want || message != tc.message || !errors.Is(err, cause) {
			t.Fatalf("category changed: %s %q", kind, message)
		}
	}
}
