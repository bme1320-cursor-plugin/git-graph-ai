# ai_service/model_providers.py

import os
import json
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from abc import ABC, abstractmethod
from openai import OpenAI, OpenAIError

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
        
        # 为提高网络请求的稳定性，增加会话和重试机制
        self.session = requests.Session()
        # 设置重试策略：总共重试3次，对5xx错误码进行重试，并设置回退避让因子
        retries = Retry(total=3,
                        backoff_factor=0.3,
                        status_forcelist=[500, 502, 503, 504])
        # 将重试策略应用到所有https请求
        self.session.mount('https://', HTTPAdapter(max_retries=retries))

        print(f"Deepseek provider initialized with model: {self.model}")
    
    def chat_completion(self, messages, max_tokens=100, temperature=0.3):
        """使用Deepseek API生成响应"""
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
                raise Exception(f"Deepseek API error: {response.status_code} - {response.text}")
                
        except requests.exceptions.RequestException as e:
            raise Exception(f"Network error when calling Deepseek API: {str(e)}")
        except json.JSONDecodeError as e:
            raise Exception(f"Failed to parse Deepseek API response: {str(e)}")
    
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