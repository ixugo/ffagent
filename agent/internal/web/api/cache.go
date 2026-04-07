package api

import (
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

// cacheStatsOutput 返回 ffagent 缓存目录占用与绝对路径，供设置页展示与清理前确认
type cacheStatsOutput struct {
	Path  string `json:"path"`
	Bytes int64  `json:"bytes"`
}

func (uc *Usecase) getCacheStats(c *gin.Context) {
	root := strings.TrimSpace(uc.Conf.CacheRoot)
	if root == "" {
		c.JSON(http.StatusOK, cacheStatsOutput{})
		return
	}
	var total int64
	_ = filepath.WalkDir(root, func(_ string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		total += info.Size()
		return nil
	})
	c.JSON(http.StatusOK, cacheStatsOutput{Path: root, Bytes: total})
}

func (uc *Usecase) postCacheClear(c *gin.Context) {
	root := strings.TrimSpace(uc.Conf.CacheRoot)
	if root == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cache root not configured"})
		return
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		slog.Error("cache clear readdir failed", "root", root, "err", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	for _, e := range entries {
		p := filepath.Join(root, e.Name())
		if err := os.RemoveAll(p); err != nil {
			slog.Warn("cache clear remove failed", "path", p, "err", err)
		}
	}
	slog.Info("cache cleared", "root", root)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
