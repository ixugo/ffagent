package ai

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBuildInputPathReminder_NoSuchFile(t *testing.T) {
	state := &agentRunState{
		attachmentPaths: map[string]struct{}{
			filepath.Clean("/Users/test/视频的文件.mp4"): {},
		},
	}

	args := []string{"-i", "/Users/test/视频文件.mp4", "-c", "copy", "out.mp4"}
	stderr := "No such file or directory"

	hint := buildInputPathReminder(args, stderr, state)
	if hint == "" {
		t.Fatal("hint should not be empty for 'No such file' error")
	}
	if !strings.Contains(hint, "/Users/test/视频文件.mp4") {
		t.Error("hint should contain the wrong input path")
	}
	if !strings.Contains(hint, "/Users/test/视频的文件.mp4") {
		t.Error("hint should contain the correct attachment path")
	}
	if !strings.Contains(hint, "逐字核对") {
		t.Error("hint should contain verification instruction")
	}
}

func TestBuildInputPathReminder_NoError(t *testing.T) {
	args := []string{"-i", "/Users/test/file.mp4", "-c", "copy", "out.mp4"}
	hint := buildInputPathReminder(args, "some normal output", nil)
	if hint != "" {
		t.Errorf("hint should be empty for non-error stderr, got: %s", hint)
	}
}

func TestBuildInputPathReminder_NoInputFlag(t *testing.T) {
	args := []string{"-c", "copy", "out.mp4"}
	hint := buildInputPathReminder(args, "No such file or directory", nil)
	if hint != "" {
		t.Errorf("hint should be empty when no -i flag present, got: %s", hint)
	}
}

func TestBuildInputPathReminder_NilState(t *testing.T) {
	args := []string{"-i", "/tmp/test.mp4", "-c", "copy", "out.mp4"}
	hint := buildInputPathReminder(args, "No such file or directory", nil)
	if hint == "" {
		t.Fatal("hint should not be empty even without state")
	}
	if strings.Contains(hint, "用户附件的正确路径") {
		t.Error("should not mention attachment paths when state is nil")
	}
}

func TestFixTimestamp(t *testing.T) {
	cases := []struct {
		input string
		want  string
	}{
		{"00:00:03", "00:00:03"},
		{"00:01:30", "00:01:30"},
		{"10", "10"},
		{"268.607", "268.607"},
		{"00:00:268.607", "268.607"},
		{"00:00:270.607", "270.607"},
		{"00:00:90", "90.000"},
		{"00:01:90", "150.000"},
		{"00:00:59", "00:00:59"},
		{"00:00:59.999", "00:00:59.999"},
		{"00:04:33.61", "00:04:33.61"},
	}
	for _, c := range cases {
		got := fixTimestamp(c.input)
		if got != c.want {
			t.Errorf("fixTimestamp(%q) = %q, want %q", c.input, got, c.want)
		}
	}
}

func TestFixTimeArgs(t *testing.T) {
	args := []string{"-i", "input.mp4", "-ss", "00:00:268.607", "-t", "00:00:05", "-c", "copy", "out.mp4"}
	fixed := fixTimeArgs(args)
	if fixed[3] != "268.607" {
		t.Errorf("-ss value should be fixed, got %q", fixed[3])
	}
	if fixed[5] != "00:00:05" {
		t.Errorf("-t value should remain unchanged, got %q", fixed[5])
	}
}

func TestNormalizeArgs_SpacedPath(t *testing.T) {
	cases := []struct {
		name  string
		input []string
		want  []string
	}{
		{
			name:  "单独元素含空格的Windows路径不应被拆分",
			input: []string{"-i", `C:\Users\sirius\Videos\2024-11-07 10-56-33.mkv`, "-c", "copy", "out.mp4"},
			want:  []string{"-i", `C:\Users\sirius\Videos\2024-11-07 10-56-33.mkv`, "-c", "copy", "out.mp4"},
		},
		{
			name:  "单独元素含空格的Unix路径不应被拆分",
			input: []string{"-i", "/Users/me/My Videos/input file.mp4", "-c", "copy", "out.mp4"},
			want:  []string{"-i", "/Users/me/My Videos/input file.mp4", "-c", "copy", "out.mp4"},
		},
		{
			name:  "合并字符串正常拆分",
			input: []string{"-y -hide_banner -i input.mp4 -c copy out.mp4"},
			want:  []string{"-y", "-hide_banner", "-i", "input.mp4", "-c", "copy", "out.mp4"},
		},
		{
			name:  "无空格参数保持不变",
			input: []string{"-i", "input.mp4", "-c", "copy", "out.mp4"},
			want:  []string{"-i", "input.mp4", "-c", "copy", "out.mp4"},
		},
		{
			name:  "含空格但不以flag开头的元素保持原样",
			input: []string{"-i", "hello world.mp4"},
			want:  []string{"-i", "hello world.mp4"},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := normalizeArgs(c.input)
			if len(got) != len(c.want) {
				t.Fatalf("len mismatch: got %v, want %v", got, c.want)
			}
			for i := range got {
				if got[i] != c.want[i] {
					t.Errorf("arg[%d] = %q, want %q\n  full got:  %v\n  full want: %v", i, got[i], c.want[i], got, c.want)
				}
			}
		})
	}
}

func TestNormalizeArgs_RealWorldSpacedPath(t *testing.T) {
	testFile := "/Users/xugo/Downloads/a b/m8 first 10s.mp4"
	if _, err := os.Stat(testFile); err != nil {
		t.Skipf("测试文件不存在: %s", testFile)
	}

	rawJSON := `{"args":["-y","-hide_banner","-ss","0","-t","3","-i","` + testFile + `","-c:v","libx264","-c:a","aac","/tmp/test_spaced_output.mp4"]}`
	var execArgs ExecuteFFmpegArgs
	if err := json.Unmarshal([]byte(rawJSON), &execArgs); err != nil {
		t.Fatalf("JSON 解析失败: %v", err)
	}

	args := normalizeArgs(execArgs.Args)

	var inputPath string
	for i, a := range args {
		if a == "-i" && i+1 < len(args) {
			inputPath = args[i+1]
			break
		}
	}
	if inputPath != testFile {
		t.Fatalf("路径被错误处理: got %q, want %q\n完整参数: %v", inputPath, testFile, args)
	}

	t.Logf("normalizeArgs 处理后参数: %v", args)
}

func TestIsToolFailureResult(t *testing.T) {
	cases := []struct {
		input string
		want  bool
	}{
		{"参数解析失败: invalid json", true},
		{"执行失败 (耗时 100ms):\nsome error", true},
		{"ffprobe 执行失败:\nsome error", true},
		{"未知的工具: foo", true},
		{"未找到输出文件", true},
		{"执行成功 (耗时 500ms)", false},
		{"normal output", false},
	}
	for _, c := range cases {
		got := isToolFailureResult(c.input)
		if got != c.want {
			t.Errorf("isToolFailureResult(%q) = %v, want %v", c.input, got, c.want)
		}
	}
}
