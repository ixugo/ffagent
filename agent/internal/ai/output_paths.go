package ai

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ensureUniquePath 在目录下生成不与已存在文件冲突的完整路径，重名时追加 " (1)" 等后缀
func ensureUniquePath(dir, baseName string) string {
	cand := filepath.Join(dir, baseName)
	if _, err := os.Stat(cand); os.IsNotExist(err) {
		return cand
	}
	ext := filepath.Ext(baseName)
	stem := strings.TrimSuffix(baseName, ext)
	for i := 1; i < 10000; i++ {
		cand = filepath.Join(dir, fmt.Sprintf("%s (%d)%s", stem, i, ext))
		if _, err := os.Stat(cand); os.IsNotExist(err) {
			return cand
		}
	}
	return filepath.Join(dir, fmt.Sprintf("%s_%s%s", stem, time.Now().Format("150405"), ext))
}

// replaceLastOutputArg 将参数列表中最后一个非选项参数替换为 newPath，供统一写入缓存目录
func replaceLastOutputArg(args []string, newPath string) []string {
	out := append([]string(nil), args...)
	for i := len(out) - 1; i >= 0; i-- {
		if !strings.HasPrefix(out[i], "-") {
			out[i] = newPath
			return out
		}
	}
	return out
}

// copyFile 将 src 完整复制到 dst，用于把成品从缓存挪到用户源文件目录
func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Sync()
}
