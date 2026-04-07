package main

import (
	"expvar"
	"flag"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/ixugo/ffagent/agent/internal/app"
	"github.com/ixugo/ffagent/agent/internal/conf"
	"github.com/ixugo/goddd/pkg/system"
)

var (
	buildVersion = "0.0.1" // 构建版本号
	gitBranch    = "dev"   // git 分支
	gitHash      = "debug" // git 提交点哈希值
	release      string    // 发布模式 true/false
	buildTime    string    // 构建时间戳
)

var (
	configDir  = flag.String("conf", "./configs", "config directory, eg: -conf /configs/")
	ffmpegDir  = flag.String("ffmpeg-dir", "", "ffmpeg/ffprobe binary directory")
)

func getBuildRelease() bool {
	v, _ := strconv.ParseBool(release)
	return v
}

func main() {
	flag.Parse()

	// 初始化配置
	var bc conf.Bootstrap
	fileDir, _ := system.Abs(*configDir)
	_ = os.MkdirAll(fileDir, 0o755)
	filePath := filepath.Join(fileDir, "config.toml")
	configIsNotExistWrite(filePath)
	if err := conf.SetupConfig(&bc, filePath); err != nil {
		panic(err)
	}
	bc.Debug = !getBuildRelease()
	bc.BuildVersion = buildVersion
	bc.ConfigDir = fileDir
	bc.ConfigPath = filePath
	bc.FFmpegBinDir = *ffmpegDir
	if envDir := os.Getenv("FFMPEG_BIN_DIR"); envDir != "" && bc.FFmpegBinDir == "" {
		bc.FFmpegBinDir = envDir
	}
	if cacheDir := os.Getenv("FFAGENT_CACHE_DIR"); cacheDir != "" {
		bc.CacheRoot, _ = filepath.Abs(cacheDir)
	} else {
		// 与常见「用户缓存目录」一致（如 macOS Library/Caches、Windows AppData Local），无 Electron 时 CLI 仍可用
		ud, err := os.UserCacheDir()
		if err != nil {
			ud = os.TempDir()
		}
		bc.CacheRoot = filepath.Join(ud, "ffagent")
	}
	_ = os.MkdirAll(bc.CacheRoot, 0o755)

	{
		expvar.NewString("version").Set(buildVersion)
		expvar.NewString("git_branch").Set(gitBranch)
		expvar.NewString("git_hash").Set(gitHash)
		expvar.NewString("build_time").Set(buildTime)
		expvar.Publish("timestamp", expvar.Func(func() any {
			return time.Now().Format(time.DateTime)
		}))
	}

	app.Run(&bc)
}

// configIsNotExistWrite 配置文件不存在时，回写配置
func configIsNotExistWrite(path string) {
	if _, err := os.Stat(path); os.IsNotExist(err) {
		if err := conf.WriteConfig(conf.DefaultConfig(), path); err != nil {
			system.ErrPrintf("WriteConfig", "err", err)
		}
	}
}
