# AI Service - 多模型支持版本

## 🎯 项目概述

这是一个支持多种AI模型的Git代码分析服务，现已扩展支持OpenAI和Deepseek模型。

## ✨ 新功能特性

### 🤖 支持的AI模型
- **OpenAI GPT-4.1-mini** - 需要配置`OPENAI_API_KEY`环境变量
- **Deepseek V3** - 内置API密钥，即开即用
- **Deepseek R1** - 内置API密钥，即开即用

### 🔄 智能切换机制
- 自动检测可用的AI提供商
- 智能选择最佳模型
- 运行时动态切换模型
- 失败自动降级

## 🚀 快速开始

### 1. 安装依赖
```bash
cd ai_service
pip install -r requirements.txt
```

### 2. 配置环境变量（可选）
```bash
# 如果想使用OpenAI（可选）
export OPENAI_API_KEY="your-openai-api-key"

# 设置首选AI提供商（可选，默认使用deepseek-v3）
export PREFERRED_AI_PROVIDER="deepseek-v3"  # 或 "openai" 或 "deepseek-r1"
```

### 3. 启动服务
```bash
python server.py
```

## 📋 API接口

### 🏥 健康检查
```bash
GET /health
```
返回服务状态和当前使用的AI提供商信息。

### 🔍 查看可用提供商
```bash
GET /providers
```
返回所有AI提供商的状态信息。

### 🔄 切换AI提供商
```bash
POST /providers/switch
Content-Type: application/json

{
  "provider": "deepseek-v3"  # 或 "deepseek-r1" 或 "openai"
}
```

### 📊 分析代码差异
```bash
POST /analyze_diff
Content-Type: application/json

{
  "file_path": "src/example.py",
  "file_diff": "git diff内容"
}
```

## 🧪 测试功能

运行集成测试脚本：
```bash
python test_deepseek.py
```

测试将验证：
- Deepseek模型连接
- 模型管理器功能
- Git分析模拟场景

## 📖 使用示例

### Python客户端示例
```python
import requests

# 检查服务状态
response = requests.get('http://localhost:5000/health')
print(response.json())

# 分析代码差异
diff_data = {
    "file_path": "example.py",
    "file_diff": """
@@ -1,3 +1,6 @@
 def hello():
-    print("Hello")
+    print("Hello World")
+
+def goodbye():
+    print("Goodbye!")
"""
}

response = requests.post('http://localhost:5000/analyze_diff', json=diff_data)
print(response.json())

# 切换AI提供商
switch_data = {"provider": "deepseek-r1"}
response = requests.post('http://localhost:5000/providers/switch', json=switch_data)
print(response.json())
```

### curl示例
```bash
# 健康检查
curl http://localhost:5000/health

# 查看提供商状态
curl http://localhost:5000/providers

# 切换到Deepseek R1
curl -X POST http://localhost:5000/providers/switch \
  -H "Content-Type: application/json" \
  -d '{"provider": "deepseek-r1"}'

# 分析代码差异
curl -X POST http://localhost:5000/analyze_diff \
  -H "Content-Type: application/json" \
  -d '{
    "file_path": "test.py",
    "file_diff": "@@ -1,1 +1,2 @@\n print(\"hello\")\n+print(\"world\")"
  }'
```

## 🔧 配置说明

### 环境变量
- `PREFERRED_AI_PROVIDER`: 首选AI提供商（默认: `deepseek-v3`）
- `OPENAI_API_KEY`: OpenAI API密钥（仅使用OpenAI时需要）

### 提供商优先级
1. 用户指定的首选提供商
2. OpenAI（如果配置了API密钥）
3. Deepseek V3
4. Deepseek R1

## 🏗️ 架构设计

### 核心组件
- `ModelProvider`: 抽象基类，定义AI提供商接口
- `OpenAIProvider`: OpenAI模型实现
- `DeepseekProvider`: Deepseek模型实现
- `ModelManager`: 模型管理器，负责选择和切换提供商

### 设计亮点
- **抽象化设计**: 统一的API接口，易于扩展新模型
- **智能降级**: 主要提供商不可用时自动切换备选方案
- **零配置使用**: Deepseek模型内置密钥，即装即用
- **向后兼容**: 完全兼容原有的OpenAI功能

## 🌟 Deepseek模型特色

### Deepseek V3
- 🎯 专注代码理解和生成
- ⚡ 响应速度快
- 🔧 适合日常代码分析

### Deepseek R1
- 🧠 推理能力强
- 📊 适合复杂代码分析
- 🎪 支持多步推理

## 🔮 扩展建议

基于当前架构，未来可以轻松扩展：

1. **添加新的AI模型**
   ```python
   class ClaudeProvider(ModelProvider):
       # 实现Claude API
   ```

2. **添加模型配置文件**
   ```json
   {
     "models": {
       "claude-3": {
         "endpoint": "...",
         "api_key": "..."
       }
     }
   }
   ```

3. **添加负载均衡**
   ```python
   class LoadBalancer:
       def select_provider(self, request_type):
           # 根据请求类型选择最佳提供商
   ```

4. **添加缓存机制**
   ```python
   class CacheProvider(ModelProvider):
       def chat_completion(self, messages, **kwargs):
           # 先检查缓存，再调用实际模型
   ```

## 📝 更新日志

### v2.0.0 (当前版本)
- ✅ 添加Deepseek V3和R1支持
- ✅ 实现多模型管理架构
- ✅ 添加运行时模型切换
- ✅ 保持向后兼容
- ✅ 添加完整的测试套件

### v1.0.0 (原版本)
- ✅ 基础OpenAI集成
- ✅ Git代码分析功能
- ✅ RESTful API接口

## 🤝 贡献指南

欢迎贡献新的AI模型支持！请遵循以下步骤：

1. 继承`ModelProvider`基类
2. 实现必要的抽象方法
3. 在`ModelManager`中注册新提供商
4. 添加相应的测试用例
5. 更新文档

## 📄 许可证

本项目遵循MIT许可证。 