package ai

import (
	"encoding/json"
	"log/slog"
	"sync"

	openai "github.com/sashabaranov/go-openai"
)

// OpenAIConfig 存储在 SQLite configs 表中的 openai 配置
type OpenAIConfig struct {
	BaseURL  string `json:"base_url"`
	APIKey   string `json:"api_key"`
	Model    string `json:"model"`
	Thinking bool   `json:"thinking"`
}

// Client 封装 OpenAI 兼容 API 客户端，支持运行时热更新配置
type Client struct {
	mu     sync.RWMutex
	client *openai.Client
	config OpenAIConfig
}

// NewClient 使用默认配置创建客户端
func NewClient() *Client {
	cfg := OpenAIConfig{
		BaseURL: "http://127.0.0.1:1234/v1",
		APIKey:  "not-needed",
		Model:   "local-model",
	}
	c := &Client{config: cfg}
	c.rebuildClient()
	return c
}

// rebuildClient 根据当前配置重建底层 openai.Client
func (c *Client) rebuildClient() {
	clientCfg := openai.DefaultConfig(c.config.APIKey)
	clientCfg.BaseURL = c.config.BaseURL
	c.client = openai.NewClientWithConfig(clientCfg)
}

// UpdateConfig 热更新配置，前端保存后调用
func (c *Client) UpdateConfig(cfgJSON string) error {
	var cfg OpenAIConfig
	if err := json.Unmarshal([]byte(cfgJSON), &cfg); err != nil {
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.config = cfg
	c.rebuildClient()
	slog.Info("ai client config updated", "base_url", cfg.BaseURL, "model", cfg.Model)
	return nil
}

// GetClient 获取线程安全的底层客户端
func (c *Client) GetClient() *openai.Client {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.client
}

// GetModel 获取当前模型名称
func (c *Client) GetModel() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.config.Model
}

// GetConfig 获取当前配置
func (c *Client) GetConfig() OpenAIConfig {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.config
}

// IsThinking 返回当前是否启用思考模式
func (c *Client) IsThinking() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.config.Thinking
}
