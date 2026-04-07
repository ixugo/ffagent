package api

import (
	"unicode/utf8"

	openai "github.com/sashabaranov/go-openai"
)

// chatHistoryMaxRunes 发往模型的历史对话总字数上限（按 Unicode 字符计）；超出则从最早的消息开始丢弃，保留尾部
// 需要足够容纳 ffprobe 媒体信息和多轮对话内容
const chatHistoryMaxRunes = 16384

// trimChatHistoryRunes 裁剪历史消息，使各条 content 的 rune 总数不超过 maxRunes；单条超长时只保留该条尾部
func trimChatHistoryRunes(msgs []openai.ChatCompletionMessage, maxRunes int) []openai.ChatCompletionMessage {
	if len(msgs) == 0 || maxRunes <= 0 {
		return msgs
	}
	for start := 0; start < len(msgs); start++ {
		sub := msgs[start:]
		total := 0
		for _, m := range sub {
			total += utf8.RuneCountInString(m.Content)
		}
		if total <= maxRunes {
			return sub
		}
	}
	last := msgs[len(msgs)-1]
	r := []rune(last.Content)
	if len(r) > maxRunes {
		last.Content = string(r[len(r)-maxRunes:])
	}
	return []openai.ChatCompletionMessage{last}
}
