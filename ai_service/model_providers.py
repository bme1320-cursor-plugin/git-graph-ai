# ai_service/model_providers.py

import os
import json
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from abc import ABC, abstractmethod
from openai import OpenAI, OpenAIError
from token_manager import TokenManager

class ModelProvider(ABC):
    """AI模型提供商的抽象基类"""
    
    @abstractmethod
    def chat_completion(self, messages, max_tokens=100, temperature=0.3):
        """生成聊天完成响应"""
        pass
    
    @abstractmethod
    def is_available(self):
        """检查模型是否可用"""
        pass
    
    @abstractmethod
    def get_provider_name(self):
        """获取提供商名称"""
        pass

class OpenAIProvider(ModelProvider):
    """OpenAI模型提供商"""
    
    def __init__(self, api_key=None, model="gpt-4.1-mini"):
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY")
        self.model = model
        self.client = None
        self.token_manager = TokenManager(model)
        
        if self.api_key:
            try:
                self.client = OpenAI(api_key=self.api_key)
                print(f"OpenAI client initialized successfully with model: {self.model}")
            except Exception as e:
                print(f"Error initializing OpenAI client: {e}")
                self.client = None
    
    def chat_completion(self, messages, max_tokens=100, temperature=0.3):
        """使用OpenAI API生成响应"""
        if not self.client:
            raise Exception("OpenAI client not available")
        
        # 验证 token 大小
        is_valid, estimated_tokens, recommendation = self.token_manager.validate_prompt_size(messages)
        if not is_valid:
            raise Exception(f"Token limit exceeded: {recommendation}")
        
        try:
            response = self.client.chat.completions.create(
                messages=messages,
                model=self.model,
                max_tokens=max_tokens,
                temperature=temperature,
                n=1
            )
            return response.choices[0].message.content.strip()
        except OpenAIError as e:
            raise Exception(f"OpenAI API error: {str(e)}")
    
    def is_available(self):
        """检查OpenAI是否可用"""
        return self.client is not None
    
    def get_provider_name(self):
        """获取提供商名称"""
        return f"OpenAI ({self.model})"

class DeepseekProvider(ModelProvider):
    """Deepseek模型提供商"""
    
    # Deepseek模型配置
    DEEPSEEK_MODELS = {
        "deepseek-v3": {
            "model": "deepseek-v3:671b",
            "api_key": "15c7cc86cc4e44aa978cbbebd70f7975"
        },
        "deepseek-r1": {
            "model": "deepseek-r1:671b", 
            "api_key": "0b755452512d486c974e27ba20721a44"
        }
    }
    
    def __init__(self, model_name="deepseek-v3"):
        self.model_name = model_name
        self.base_url = "https://genaiapi.shanghaitech.edu.cn/api/v1/start/chat/completions"
        
        if model_name not in self.DEEPSEEK_MODELS:
            raise ValueError(f"Unsupported Deepseek model: {model_name}. Available: {list(self.DEEPSEEK_MODELS.keys())}")
        
        self.config = self.DEEPSEEK_MODELS[model_name]
        self.model = self.config["model"]
        self.api_key = self.config["api_key"]
        
        # 初始化 token 管理器
        self.token_manager = TokenManager(model_name)
        
        # 为提高网络请求的稳定性，增加会话和重试机制
        self.session = requests.Session()
        # 设置重试策略：总共重试3次，对5xx错误码进行重试，并设置回退避让因子
        retries = Retry(total=3,
                        backoff_factor=0.3,
                        status_forcelist=[500, 502, 503, 504])
        # 将重试策略应用到所有https请求
        self.session.mount('https://', HTTPAdapter(max_retries=retries))

        print(f"Deepseek provider initialized with model: {self.model}")
        print(f"Token manager configured - Max tokens: {self.token_manager.max_tokens}, Available: {self.token_manager.available_tokens}")
    
    def chat_completion(self, messages, max_tokens=100, temperature=0.3):
        """使用Deepseek API生成响应"""
        
        # 🚀 新增：Token 大小验证和优化
        is_valid, estimated_tokens, recommendation = self.token_manager.validate_prompt_size(messages)
        
        if not is_valid:
            print(f"⚠️ Token limit exceeded for {self.model_name}: {estimated_tokens} tokens, {recommendation}")
            
            # 尝试自动优化 prompt
            optimized_messages = self._optimize_messages(messages)
            
            # 重新验证优化后的消息
            is_valid_after_opt, new_estimated_tokens, new_recommendation = self.token_manager.validate_prompt_size(optimized_messages)
            
            if is_valid_after_opt:
                print(f"✅ Successfully optimized prompt: {estimated_tokens} -> {new_estimated_tokens} tokens")
                messages = optimized_messages
            else:
                # 如果优化后仍然超限，抛出详细错误
                raise Exception(f"Token limit exceeded even after optimization. {new_recommendation} Original: {estimated_tokens} tokens, Optimized: {new_estimated_tokens} tokens, Limit: {self.token_manager.available_tokens} tokens.")
        else:
            print(f"✅ Token validation passed for {self.model_name}: {estimated_tokens}/{self.token_manager.available_tokens} tokens")
        
        headers = {
            'accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {self.api_key}'
        }
        
        payload = {
            "model": self.model,
            "messages": messages,
            "max_tokens": max_tokens,
            "stream": False,
            "temperature": temperature
        }
        
        try:
            # 使用带有重试机制的session进行请求
            response = self.session.post(
                self.base_url,
                headers=headers,
                json=payload,
                timeout=60
            )
            
            if response.status_code == 200:
                result = response.json()
                
                if 'choices' in result and len(result['choices']) > 0:
                    choice = result['choices'][0]
                    # 兼容不同的响应格式
                    if 'message' in choice:
                        message = choice['message']
                        # Deepseek R1 模型使用 reasoning_content 字段
                        if 'reasoning_content' in message and message['reasoning_content']:
                            return message['reasoning_content'].strip()
                        elif 'content' in message and message['content']:
                            return message['content'].strip()
                        else:
                            # 如果content为空，但有其他字段，返回第一个非空字段
                            for field in ['reasoning_content', 'content', 'text']:
                                if field in message and message[field]:
                                    return message[field].strip()
                    elif 'text' in choice:
                        return choice['text'].strip()
                    elif 'content' in choice:
                        return choice['content'].strip()
                    
                    # 如果没有找到预期的内容，记录警告并返回整个choice
                    print(f"WARNING: Unexpected choice format for {self.model_name}: {choice}")
                    return f"AI返回了预期外的格式，请检查API响应。"
                else:
                    raise Exception(f"Invalid response format from Deepseek API: missing choices. Response: {result}")
            else:
                # 🚀 改进：针对 400 错误（通常是 token 超限）的特殊处理
                if response.status_code == 400:
                    try:
                        error_data = response.json()
                        if 'message' in error_data and 'maximum context length' in error_data['message']:
                            # 提取具体的 token 信息
                            raise Exception(f"DeepSeek Token Limit Exceeded: {error_data['message']}. 建议减少分析的文件数量或使用更简洁的内容。")
                    except json.JSONDecodeError:
                        pass
                
                raise Exception(f"Deepseek API error: {response.status_code} - {response.text}")
                
        except requests.exceptions.RequestException as e:
            raise Exception(f"Network error when calling Deepseek API: {str(e)}")
        except json.JSONDecodeError as e:
            raise Exception(f"Failed to parse Deepseek API response: {str(e)}")
    
    def _optimize_messages(self, messages):
        """
        优化消息内容以减少 token 使用
        """
        optimized_messages = []
        
        for message in messages:
            role = message.get('role', 'user')
            content = message.get('content', '')
            
            if role == 'system':
                # 系统消息保持不变
                optimized_messages.append(message)
            elif role == 'user':
                # 优化用户消息内容
                optimized_content = self._optimize_user_content(content)
                optimized_messages.append({
                    'role': role,
                    'content': optimized_content
                })
            else:
                # 其他消息类型保持不变
                optimized_messages.append(message)
        
        return optimized_messages
    
    def _optimize_user_content(self, content):
        """
        优化用户消息内容
        """
        if not content:
            return content
        
        # 尝试识别并优化综合分析的内容
        if '主要文件变更：' in content:
            return self._optimize_comprehensive_analysis_content(content)
        
        # 对于其他类型的内容，进行通用优化
        return self._optimize_generic_content(content)
    
    def _optimize_comprehensive_analysis_content(self, content):
        """
        优化综合分析内容
        """
        lines = content.split('\n')
        optimized_lines = []
        
        # 保留基本信息部分
        for line in lines:
            if any(keyword in line for keyword in ['提交信息：', '提交哈希:', '作者:', '提交消息:', '比较概览：', '未提交变更信息：']):
                optimized_lines.append(line)
            elif line.startswith('主要文件变更：'):
                optimized_lines.append(line)
                break
        
        # 添加优化的文件变更部分
        in_file_section = False
        file_count = 0
        max_files = 3  # 限制最多显示3个文件
        
        for line in lines:
            if line.startswith('主要文件变更：'):
                in_file_section = True
                continue
            
            if in_file_section:
                if line.strip() and line[0].isdigit():  # 新文件开始
                    file_count += 1
                    if file_count > max_files:
                        optimized_lines.append(f"\n[还有 {len([l for l in lines if l.strip() and l[0].isdigit()]) - max_files} 个文件已省略以减少token使用]")
                        break
                    
                    optimized_lines.append(line)
                elif line.startswith('   变更类型:'):
                    optimized_lines.append(line)
                elif line.startswith('   差异内容:'):
                    optimized_lines.append(line)
                    # 添加压缩的diff内容
                    diff_lines = []
                    for next_line in lines[lines.index(line)+1:]:
                        if next_line.strip() and next_line[0].isdigit():
                            break
                        if next_line.startswith('   ```'):
                            continue
                        if next_line.strip():
                            diff_lines.append(next_line)
                    
                    # 压缩diff内容
                    if diff_lines:
                        compressed_diff = self._compress_diff_lines(diff_lines[:10])  # 最多保留10行
                        optimized_lines.extend(compressed_diff)
                        if len(diff_lines) > 10:
                            optimized_lines.append('   [diff内容已压缩，原有更多行]')
                elif not line.startswith('   ```') and not line.strip().startswith('```'):
                    # 跳过代码块标记
                    continue
        
        # 添加要求部分
        for line in lines:
            if line.startswith('请提供一个综合性的分析报告'):
                optimized_lines.extend(lines[lines.index(line):])
                break
        
        return '\n'.join(optimized_lines)
    
    def _compress_diff_lines(self, diff_lines):
        """
        压缩diff行
        """
        important_lines = []
        for line in diff_lines:
            if any(indicator in line for indicator in ['+++', '---', '@@', '+', '-']):
                important_lines.append(line)
            elif len(important_lines) < 5:  # 保留一些上下文
                important_lines.append(line)
        
        return important_lines
    
    def _optimize_generic_content(self, content):
        """
        通用内容优化
        """
        # 如果内容太长，智能截断
        max_chars = self.token_manager.available_tokens * 3  # 估算字符数
        
        if len(content) > max_chars:
            # 保留开头和结尾，中间用省略号
            start_chars = max_chars // 3
            end_chars = max_chars // 3
            
            return (content[:start_chars] + 
                   f'\n\n[内容已压缩，省略了 {len(content) - start_chars - end_chars} 个字符]\n\n' + 
                   content[-end_chars:])
        
        return content
    
    def is_available(self):
        """检查Deepseek是否可用（简单的ping测试）"""
        try:
            # 发送一个简单的测试请求
            test_messages = [{"role": "user", "content": "Hello"}]
            self.chat_completion(test_messages, max_tokens=5)
            return True
        except Exception as e:
            print(f"Deepseek availability check failed: {e}")
            return False
    
    def get_provider_name(self):
        """获取提供商名称"""
        return f"Deepseek ({self.model_name})"

    def get_token_manager(self):
        """获取 token 管理器"""
        return self.token_manager

class ModelManager:
    """AI模型管理器，负责选择和切换不同的模型提供商"""
    
    def __init__(self, preferred_provider="openai"):
        self.providers = {}
        self.current_provider = None
        self.preferred_provider = preferred_provider
        
        # 初始化提供商
        self._init_providers()
        
        # 选择首选提供商
        self._select_provider()
    
    def _init_providers(self):
        """初始化所有可用的模型提供商"""
        # 初始化OpenAI
        try:
            openai_provider = OpenAIProvider()
            if openai_provider.is_available():
                self.providers["openai"] = openai_provider
                print("✅ OpenAI provider is available")
            else:
                print("❌ OpenAI provider is not available")
        except Exception as e:
            print(f"❌ Failed to initialize OpenAI: {e}")
        
        # 初始化Deepseek V3
        try:
            deepseek_v3_provider = DeepseekProvider("deepseek-v3")
            self.providers["deepseek-v3"] = deepseek_v3_provider
            print("✅ Deepseek V3 provider initialized")
        except Exception as e:
            print(f"❌ Failed to initialize Deepseek V3: {e}")
        
        # 初始化Deepseek R1
        try:
            deepseek_r1_provider = DeepseekProvider("deepseek-r1")
            self.providers["deepseek-r1"] = deepseek_r1_provider
            print("✅ Deepseek R1 provider initialized")
        except Exception as e:
            print(f"❌ Failed to initialize Deepseek R1: {e}")
    
    def _select_provider(self):
        """选择可用的提供商"""
        # 尝试使用首选提供商
        if self.preferred_provider in self.providers:
            self.current_provider = self.providers[self.preferred_provider]
            print(f"🎯 Using preferred provider: {self.current_provider.get_provider_name()}")
            return
        
        # 如果首选不可用，按优先级顺序选择
        priority_order = ["openai", "deepseek-v3", "deepseek-r1"]
        
        for provider_name in priority_order:
            if provider_name in self.providers:
                provider = self.providers[provider_name]
                # 检查提供商是否真的可用
                try:
                    if provider.is_available() or provider_name.startswith("deepseek"):
                        self.current_provider = provider
                        print(f"🔄 Fallback to provider: {self.current_provider.get_provider_name()}")
                        return
                except:
                    continue
        
        print("❌ No AI providers are available")
        self.current_provider = None
    
    def get_current_provider(self):
        """获取当前使用的提供商"""
        return self.current_provider
    
    def is_available(self):
        """检查是否有可用的AI服务"""
        return self.current_provider is not None
    
    def chat_completion(self, messages, max_tokens=100, temperature=0.3):
        """使用当前提供商生成聊天完成响应"""
        if not self.current_provider:
            raise Exception("No AI provider is available")
        
        return self.current_provider.chat_completion(messages, max_tokens, temperature)
    
    def get_provider_status(self):
        """获取所有提供商的状态信息"""
        status = {
            "current": self.current_provider.get_provider_name() if self.current_provider else None,
            "available_providers": [
                {
                    "name": name,
                    "display_name": provider.get_provider_name(),
                    "is_current": provider == self.current_provider
                }
                for name, provider in self.providers.items()
            ]
        }
        return status
    
    def switch_provider(self, provider_name):
        """切换到指定的提供商"""
        if provider_name not in self.providers:
            raise ValueError(f"Provider '{provider_name}' not found. Available: {list(self.providers.keys())}")
        
        old_provider = self.current_provider.get_provider_name() if self.current_provider else "None"
        self.current_provider = self.providers[provider_name]
        new_provider = self.current_provider.get_provider_name()
        
        print(f"🔄 Switched from {old_provider} to {new_provider}")
        return new_provider 