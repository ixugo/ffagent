package ffmpeg

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// MediaInfo ffprobe 返回的媒体信息摘要
type MediaInfo struct {
	Format  FormatInfo   `json:"format"`
	Streams []StreamInfo `json:"streams"`
}

type FormatInfo struct {
	Filename   string `json:"filename"`
	FormatName string `json:"format_name"`
	Duration   string `json:"duration"`
	Size       string `json:"size"`
	BitRate    string `json:"bit_rate"`
}

type StreamInfo struct {
	Index     int    `json:"index"`
	CodecType string `json:"codec_type"`
	CodecName string `json:"codec_name"`
	Width     int    `json:"width,omitempty"`
	Height    int    `json:"height,omitempty"`
	Duration  string `json:"duration,omitempty"`
	BitRate   string `json:"bit_rate,omitempty"`
}

// Probe 获取媒体文件信息
func (e *Executor) Probe(ctx context.Context, filePath string) (*MediaInfo, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	result, err := e.RunFFprobe(ctx, []string{
		"-v", "quiet",
		"-print_format", "json",
		"-show_format",
		"-show_streams",
		filePath,
	})
	if err != nil {
		return nil, fmt.Errorf("ffprobe failed: %w", err)
	}

	var info MediaInfo
	if err := json.Unmarshal([]byte(result.Stdout), &info); err != nil {
		return nil, fmt.Errorf("parse ffprobe output: %w", err)
	}
	return &info, nil
}

// ProbeAsText 获取媒体文件信息并格式化为易读文本（供 AI 使用）
func (e *Executor) ProbeAsText(ctx context.Context, filePath string) (string, error) {
	info, err := e.Probe(ctx, filePath)
	if err != nil {
		return "", err
	}

	summary := fmt.Sprintf("文件: %s\n格式: %s\n时长: %ss\n大小: %s bytes\n",
		info.Format.Filename, info.Format.FormatName, info.Format.Duration, info.Format.Size)

	for _, s := range info.Streams {
		if s.CodecType == "video" {
			summary += fmt.Sprintf("视频流: %s %dx%d\n", s.CodecName, s.Width, s.Height)
		} else if s.CodecType == "audio" {
			summary += fmt.Sprintf("音频流: %s\n", s.CodecName)
		}
	}
	return summary, nil
}
