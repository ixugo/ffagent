package ffmpeg

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// Executor 封装 ffmpeg/ffprobe 命令执行
type Executor struct {
	ffmpegBin  string
	ffprobeBin string
}

// NewExecutor 创建执行器，binDir 为二进制所在目录（空则使用系统 PATH）
// Tauri externalBin 会生成带 target 后缀的文件名（如 ffmpeg-aarch64-apple-darwin），需在目录内探测真实路径
func NewExecutor(binDir string) *Executor {
	e := &Executor{
		ffmpegBin:  resolveBundledBinary(binDir, "ffmpeg"),
		ffprobeBin: resolveBundledBinary(binDir, "ffprobe"),
	}
	slog.Info("ffmpeg executor init", "ffmpeg", e.ffmpegBin, "ffprobe", e.ffprobeBin, "binDir", binDir)
	return e
}

// bundledBinaryCandidates 列出候选路径：因 Tauri 打包后文件名带平台后缀，不能假定固定为 ffmpeg/ffprobe
func bundledBinaryCandidates(binDir, base string) []string {
	var c []string
	c = append(c, filepath.Join(binDir, base))
	if runtime.GOOS == "windows" {
		c = append(c, filepath.Join(binDir, base+".exe"))
		c = append(c, filepath.Join(binDir, base+"-x86_64-pc-windows-msvc.exe"))
		return c
	}
	if runtime.GOOS == "darwin" {
		if runtime.GOARCH == "arm64" {
			c = append(c, filepath.Join(binDir, base+"-aarch64-apple-darwin"))
		}
		c = append(c, filepath.Join(binDir, base+"-x86_64-apple-darwin"))
		return c
	}
	c = append(c, filepath.Join(binDir, base+"-x86_64-unknown-linux-gnu"))
	return c
}

// resolveBundledBinary 在 binDir 中探测真实可执行文件；开发机已装 ffmpeg 时回退 PATH，避免侧载目录仅有带后缀二进制却拼错路径
func resolveBundledBinary(binDir, base string) string {
	if binDir == "" {
		return base
	}
	for _, p := range bundledBinaryCandidates(binDir, base) {
		st, err := os.Stat(p)
		if err != nil || st.IsDir() {
			continue
		}
		return p
	}
	slog.Warn("bundled binary not found, use PATH", "base", base, "binDir", binDir)
	return base
}

// RunResult 命令执行结果
type RunResult struct {
	Stdout   string
	Stderr   string
	ExitCode int
	Duration time.Duration
}

// RunFFmpeg 执行 ffmpeg 命令，默认超时 10 分钟
func (e *Executor) RunFFmpeg(ctx context.Context, args []string) (*RunResult, error) {
	return e.run(ctx, e.ffmpegBin, args)
}

// RunFFprobe 执行 ffprobe 命令，默认超时 30 秒
func (e *Executor) RunFFprobe(ctx context.Context, args []string) (*RunResult, error) {
	return e.run(ctx, e.ffprobeBin, args)
}

// FFmpegVersionLine 执行 ffmpeg -version 并返回首行，供系统提示词告知模型当前侧载/ PATH 中的 ffmpeg 版本
func (e *Executor) FFmpegVersionLine(ctx context.Context) string {
	cctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(cctx, e.ffmpegBin, "-version")
	out, err := cmd.Output()
	if err != nil {
		slog.Debug("ffmpeg -version failed", "err", err)
		return "ffmpeg 版本：查询失败"
	}
	first := strings.TrimSpace(strings.Split(string(out), "\n")[0])
	if first == "" {
		return "ffmpeg 版本：未知"
	}
	return first
}

func (e *Executor) run(ctx context.Context, bin string, args []string) (*RunResult, error) {
	slog.Debug("ffmpeg exec start", "bin", bin, "arg_count", len(args), "args", args)

	start := time.Now()

	cmd := exec.CommandContext(ctx, bin, args...)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	duration := time.Since(start)

	result := &RunResult{
		Stdout:   stdout.String(),
		Stderr:   stderr.String(),
		Duration: duration,
	}

	if cmd.ProcessState != nil {
		result.ExitCode = cmd.ProcessState.ExitCode()
	}

	slog.Debug("ffmpeg exec end",
		"bin", bin,
		"exit_code", result.ExitCode,
		"duration_ms", duration.Milliseconds(),
		"stdout_len", len(result.Stdout),
		"stderr_preview", truncate(result.Stderr, 400),
	)

	if err != nil {
		slog.Error("ffmpeg exec failed",
			"bin", bin,
			"exit_code", result.ExitCode,
			"duration", duration,
			"stderr", truncate(result.Stderr, 800),
		)
		return result, fmt.Errorf("ffmpeg exit code %d: %s", result.ExitCode, truncate(result.Stderr, 200))
	}

	slog.Info("ffmpeg exec succeeded", "bin", bin, "duration", duration)
	return result, nil
}

// truncate 截断字符串到指定长度
func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
