package data

import (
	"path/filepath"
	"strings"

	"github.com/glebarez/sqlite"
	"github.com/google/wire"
	"github.com/ixugo/ffagent/agent/internal/conf"
	"github.com/ixugo/goddd/pkg/orm"
	"github.com/ixugo/goddd/pkg/system"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// ProviderSet is data providers.
var ProviderSet = wire.NewSet(SetupDB)

// SetupDB 初始化数据存储
func SetupDB(c *conf.Bootstrap) (*gorm.DB, error) {
	cfg := c.Data.Database
	dial, isSQLite := getDialector(cfg.Dsn, c.ConfigDir)
	if isSQLite {
		cfg.MaxIdleConns = 1
		cfg.MaxOpenConns = 1
	}
	db, err := orm.New(dial, orm.Config{
		MaxIdleConns:    int(cfg.MaxIdleConns),
		MaxOpenConns:    int(cfg.MaxOpenConns),
		ConnMaxLifetime: cfg.ConnMaxLifetime.Duration(),
		SlowThreshold:   cfg.SlowThreshold.Duration(),
	})
	return db, err
}

// getDialector 返回 dial 和 是否 sqlite
// 使用 configDir 而非 cwd 作为 SQLite 相对路径的基准，避免 sidecar 工作目录不可写的问题
func getDialector(dsn, configDir string) (gorm.Dialector, bool) {
	if strings.HasPrefix(dsn, "postgres") {
		return postgres.New(postgres.Config{
			DriverName: "pgx",
			DSN:        dsn,
		}), false
	}
	baseDir := configDir
	if baseDir == "" {
		baseDir = system.Getwd()
	}
	dbPath := dsn
	if !filepath.IsAbs(dsn) {
		dbPath = filepath.Join(baseDir, dsn)
	}
	return sqlite.Open(dbPath), true
}
