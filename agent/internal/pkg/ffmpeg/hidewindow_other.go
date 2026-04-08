//go:build !windows

package ffmpeg

import "os/exec"

// hideWindow 非 Windows 平台无需特殊处理
func hideWindow(_ *exec.Cmd) {}
