package app

import (
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/ixugo/ffagent/agent/internal/conf"
	"github.com/ixugo/goddd/pkg/logger"
	"github.com/ixugo/goddd/pkg/orm"
	"github.com/ixugo/goddd/pkg/server"
	"github.com/ixugo/goddd/pkg/system"
)

func Run(bc *conf.Bootstrap) {
	// 优先使用 ConfigDir 作为工作目录，确保相对路径（日志、数据库）能正确解析
	workDir := bc.ConfigDir
	if workDir == "" {
		bin, _ := os.Executable()
		workDir = filepath.Dir(bin)
	}
	if err := os.Chdir(workDir); err != nil {
		slog.Error("change work dir fail", "dir", workDir, "err", err)
	}

	log, clean := SetupLog(bc)
	defer clean()

	if bc.Server.HTTP.JwtSecret == "" {
		bc.Server.HTTP.JwtSecret = orm.GenerateRandomString(32)
	}

	handler, cleanUp, err := WireApp(bc, log)
	if err != nil {
		slog.Error("程序构建失败", "err", err)
		panic(err)
	}
	defer cleanUp()

	// 预先占用监听端口并交给 http.Server，避免端口探测与实际绑定不一致
	ln, port := listenLoopbackPort(bc.Server.HTTP.Port)

	svc := server.New(handler,
		server.Listener(ln),
		server.ReadTimeout(bc.Server.HTTP.Timeout.Duration()),
		server.WriteTimeout(bc.Server.HTTP.Timeout.Duration()),
	)
	go svc.Start()
	interrupt := make(chan os.Signal, 1)
	signal.Notify(interrupt, syscall.SIGINT, syscall.SIGTERM)

	// Electron 主进程读取此行获取实际端口号
	fmt.Printf("PORT=%d\n", port)
	logDir := filepath.Join(bc.ConfigDir, bc.Log.Dir)
	slog.Info("服务启动成功", "port", port, "config_dir", bc.ConfigDir, "log_dir", logDir, "cache_root", bc.CacheRoot)

	select {
	case s := <-interrupt:
		slog.Info(`<-interrupt`, "signal", s.String())
	case err := <-svc.Notify():
		system.ErrPrintf("err: %s\n", err.Error())
		slog.Error(`<-server.Notify()`, "err", err)
	}
	if err := svc.Shutdown(); err != nil {
		slog.Error(`server.Shutdown()`, "err", err)
	}
}

// listenLoopbackPort 在 127.0.0.1 上从 basePort 起尝试绑定，返回已监听的 Listener 与端口
func listenLoopbackPort(basePort int) (net.Listener, int) {
	for i := 0; i < 10; i++ {
		p := basePort + i
		addr := fmt.Sprintf("127.0.0.1:%d", p)
		ln, err := net.Listen("tcp", addr)
		if err != nil {
			slog.Warn("port occupied, trying next", "port", p, "err", err)
			continue
		}
		return ln, p
	}
	slog.Error("all ports occupied, fallback to base port", "base", basePort)
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", basePort))
	if err != nil {
		panic(err)
	}
	return ln, basePort
}

// SetupLog 初始化日志，使用 ConfigDir 作为基准确保日志写入正确位置
func SetupLog(bc *conf.Bootstrap) (*slog.Logger, func()) {
	baseDir := bc.ConfigDir
	if baseDir == "" {
		baseDir = system.Getwd()
	}
	logDir := filepath.Join(baseDir, bc.Log.Dir)
	return logger.SetupSlog(logger.Config{
		Dir:          logDir,                            // 日志地址
		Debug:        bc.Debug,                          // 服务级别Debug/Release
		MaxAge:       bc.Log.MaxAge.Duration(),          // 日志存储时间
		RotationTime: bc.Log.RotationTime.Duration(),    // 循环时间
		RotationSize: bc.Log.RotationSize * 1024 * 1024, // 循环大小
		Level:        bc.Log.Level,                      // 日志级别
	})
}
