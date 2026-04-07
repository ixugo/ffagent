package api

import (
	"net/http"
	"path/filepath"

	"github.com/gin-gonic/gin"
)

// appInfoOutput 返回 Agent 数据目录、日志目录与缓存根路径，便于在设置页展示与排障
type appInfoOutput struct {
	ConfigDir string `json:"config_dir"`
	LogDir    string `json:"log_dir"`
	CacheRoot string `json:"cache_root"`
}

func (uc *Usecase) getAppInfo(c *gin.Context) {
	base := uc.Conf.ConfigDir
	logDir := filepath.Join(base, uc.Conf.Log.Dir)
	c.JSON(http.StatusOK, appInfoOutput{
		ConfigDir: base,
		LogDir:    logDir,
		CacheRoot: uc.Conf.CacheRoot,
	})
}
