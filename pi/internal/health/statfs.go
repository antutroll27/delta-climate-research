//go:build linux || darwin

package health

import (
	"fmt"
	"syscall"
)

// statfsDisk reads path's filesystem with statfs(2). Bsize is int64 on Linux and
// uint32 on macOS; converting both to uint64 keeps one file for both.
func statfsDisk(path string) (Disk, error) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return Disk{}, fmt.Errorf("statfs %s: %w", path, err)
	}
	bs := uint64(st.Bsize)
	return Disk{Free: st.Bavail * bs, Total: st.Blocks * bs}, nil
}
