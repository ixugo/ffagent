package ai

import (
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
