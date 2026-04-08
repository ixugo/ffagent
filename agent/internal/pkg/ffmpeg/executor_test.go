package ffmpeg

import (
	"context"
	"os"
	"testing"
)

func TestRunFFprobe_SpacedPath(t *testing.T) {
	testFile := "/Users/xugo/Downloads/a b/m8 first 10s.mp4"
	if _, err := os.Stat(testFile); err != nil {
		t.Skipf("测试文件不存在: %s", testFile)
	}

	e := NewExecutor("")
	result, err := e.RunFFprobe(context.Background(), []string{
		"-v", "quiet",
		"-print_format", "json",
		"-show_format",
		testFile,
	})
	if err != nil {
		t.Fatalf("ffprobe 执行失败: %v\nstderr: %s", err, result.Stderr)
	}
	if result.Stdout == "" {
		t.Fatal("ffprobe 输出为空")
	}
	t.Logf("ffprobe 输出长度: %d bytes", len(result.Stdout))
}

func TestRunFFmpeg_SpacedPath(t *testing.T) {
	testFile := "/Users/xugo/Downloads/a b/m8 first 10s.mp4"
	if _, err := os.Stat(testFile); err != nil {
		t.Skipf("测试文件不存在: %s", testFile)
	}

	outFile := "/tmp/test_spaced_path_output.mp4"
	defer os.Remove(outFile)

	e := NewExecutor("")
	result, err := e.RunFFmpeg(context.Background(), []string{
		"-y", "-hide_banner",
		"-ss", "0", "-t", "3",
		"-i", testFile,
		"-c:v", "libx264", "-c:a", "aac",
		outFile,
	})
	if err != nil {
		t.Fatalf("ffmpeg 执行失败: %v\nstderr: %s", err, result.Stderr)
	}

	st, err := os.Stat(outFile)
	if err != nil {
		t.Fatalf("输出文件不存在: %v", err)
	}
	if st.Size() == 0 {
		t.Fatal("输出文件为空")
	}
	t.Logf("输出文件大小: %d bytes, 耗时: %s", st.Size(), result.Duration)
}
