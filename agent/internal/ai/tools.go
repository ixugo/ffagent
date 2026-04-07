package ai

import (
	"encoding/json"

	openai "github.com/sashabaranov/go-openai"
)

// ExecuteFFmpegArgs AI 通过 Function Calling 返回的 ffmpeg 命令参数
type ExecuteFFmpegArgs struct {
	Args []string `json:"args"`
	// IsIntermediate 为 true 表示临时/中间产物：不向用户推送文件链接，任务结束后由程序尝试删除
	IsIntermediate bool `json:"is_intermediate"`
}

// ParseExecuteFFmpegArgs 从 tool call 参数 JSON 中解析 ffmpeg 参数
func ParseExecuteFFmpegArgs(arguments string) (ExecuteFFmpegArgs, error) {
	var args ExecuteFFmpegArgs
	err := json.Unmarshal([]byte(arguments), &args)
	return args, err
}

// FFmpegTool 返回 execute_ffmpeg 的 Function Calling tool 定义
func FFmpegTool() openai.Tool {
	return openai.Tool{
		Type: openai.ToolTypeFunction,
		Function: &openai.FunctionDefinition{
			Name:        "execute_ffmpeg",
			Description: "执行 ffmpeg 命令处理音视频文件。传入 ffmpeg 命令行参数数组（不含 ffmpeg 本身）。输入路径（-i）必须与用户附件路径完全一致，禁止删字改字。",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"args": map[string]any{
						"type":        "array",
						"items":       map[string]any{"type": "string"},
						"description": "ffmpeg 命令行参数数组，开头应该包含 -y -hide_banner 参数。每个参数必须是数组中的独立元素！正确: [\"-ss\", \"0\", \"-t\", \"4\", \"-i\", \"input.mp4\", \"-c\", \"copy\", \"output.mp4\"]。错误: [\"-ss 0 -t 4 -i input.mp4 -c copy output.mp4\"]",
					},
					"is_intermediate": map[string]any{
						"type":        "boolean",
						"description": "本次命令产生的输出是否为中间临时文件（拼接片段、中间编码结果等）。中间文件必须为 true：不会展示给用户，任务结束后会删除。仅最终交给用户打开的文件为 false。",
					},
				},
				"required": []string{"args"},
			},
		},
	}
}

// FFprobeTool 返回 execute_ffprobe 的 Function Calling tool 定义
func FFprobeTool() openai.Tool {
	return openai.Tool{
		Type: openai.ToolTypeFunction,
		Function: &openai.FunctionDefinition{
			Name:        "execute_ffprobe",
			Description: "获取音视频文件的媒体信息。传入 ffprobe 命令行参数数组（不含 ffprobe 本身）。目标文件路径必须与用户附件路径完全一致，禁止删字改字。",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"args": map[string]any{
						"type":        "array",
						"items":       map[string]any{"type": "string"},
						"description": "ffprobe 命令行参数数组, 开头应该包含 -y -hide_banner 参数。每个参数必须是数组中的独立元素！正确: [\"-v\", \"quiet\", \"-print_format\", \"json\", \"-show_format\", \"-show_streams\", \"input.mp4\"]。错误: [\"-v quiet -print_format json -show_format -show_streams input.mp4\"]",
					},
				},
				"required": []string{"args"},
			},
		},
	}
}

// WriteFileArgs AI 通过 Function Calling 返回的写文件参数
type WriteFileArgs struct {
	Filename string `json:"filename"`
	Content  string `json:"content"`
}

// WriteFileTool 返回 execute_write_file 的 Function Calling tool 定义，用于创建 concat filelist 等辅助文件
func WriteFileTool() openai.Tool {
	return openai.Tool{
		Type: openai.ToolTypeFunction,
		Function: &openai.FunctionDefinition{
			Name:        "execute_write_file",
			Description: "在工作目录下创建文本文件（如 concat 所需的 filelist.txt）。文件将写入当前会话缓存目录。",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"filename": map[string]any{
						"type":        "string",
						"description": "文件名（不含路径），如 filelist.txt",
					},
					"content": map[string]any{
						"type":        "string",
						"description": "文件内容文本",
					},
				},
				"required": []string{"filename", "content"},
			},
		},
	}
}

// AllTools 返回所有可用的 tool 定义
func AllTools() []openai.Tool {
	return []openai.Tool{FFmpegTool(), FFprobeTool(), WriteFileTool()}
}
