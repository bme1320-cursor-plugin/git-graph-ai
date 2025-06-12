# ai_service/token_manager.py

import json
import re
from typing import List, Dict, Any, Tuple

class TokenManager:
    """
    Token 管理器，处理不同模型的 token 限制和内容优化
    """
    
    # 不同模型的 token 限制
    MODEL_LIMITS = {
        'deepseek-v3': 32768,
        'deepseek-r1': 32768,
        'gpt-4': 8192,
        'gpt-4-32k': 32768,
        'gpt-4.1': 1047576,  
        'gpt-4.1-mini': 1047576, 
    }
    
    # 保留 token 数量（用于响应生成）
    RESPONSE_TOKENS = 800
    
    def __init__(self, model_name: str = 'deepseek-v3'):
        self.model_name = model_name
        self.max_tokens = self.MODEL_LIMITS.get(model_name, 32768)
        self.available_tokens = self.max_tokens - self.RESPONSE_TOKENS
        
        # 🚀 新增：针对大上下文模型的特殊处理
        if self.max_tokens > 100000:  # 对于超大上下文模型（如 GPT-4.1）
            # 为超大模型保留更多响应空间
            self.RESPONSE_TOKENS = 2000
            self.available_tokens = self.max_tokens - self.RESPONSE_TOKENS
            print(f"Large context model detected: {model_name}, adjusted response tokens to {self.RESPONSE_TOKENS}")
        
    def estimate_tokens(self, text: str) -> int:
        """
        估算文本的 token 数量
        简化算法：大约 1 token = 4 字符（对中文和代码都有一定准确性）
        """
        if not text:
            return 0
        
        # 基础字符计数
        char_count = len(text)
        
        # 对代码内容进行调整（代码通常 token 密度更高）
        if self._is_code_content(text):
            # 代码的 token 密度通常是 1 token ≈ 3 字符
            return int(char_count / 3)
        else:
            # 普通文本的 token 密度是 1 token ≈ 4 字符
            return int(char_count / 4)
    
    def _is_code_content(self, text: str) -> bool:
        """
        判断文本是否为代码内容
        """
        code_indicators = [
            '```', 'function', 'class ', 'def ', 'import ', 'require',
            '{}', '[]', '()', '=>', '->', '::',
            '+++', '---', '@@', 'diff'
        ]
        
        # 如果包含多个代码指示符，认为是代码
        indicator_count = sum(1 for indicator in code_indicators if indicator in text)
        return indicator_count >= 2
    
    def optimize_file_analysis_data(self, file_analysis_data: List[Dict]) -> List[Dict]:
        """
        优化文件分析数据，确保总 token 数不超过限制
        注意：不限制文件数量，只进行内容截断优化（文件数量限制由插件设置控制）
        """
        if not file_analysis_data:
            return []
        
        # 计算基础 prompt 的 token 数（不包括文件内容）
        base_prompt_tokens = self._estimate_base_prompt_tokens()
        available_for_files = self.available_tokens - base_prompt_tokens
        
        # 如果可用 token 太少，返回空列表
        if available_for_files < 100:
            return []
        
        optimized_files = []
        used_tokens = 0
        
        for file_data in file_analysis_data:
            # 优化单个文件的内容
            optimized_file = self._optimize_single_file(file_data, available_for_files - used_tokens)
            
            if optimized_file:
                file_tokens = self._estimate_file_tokens(optimized_file)
                
                # 检查是否还有足够的空间
                if used_tokens + file_tokens <= available_for_files:
                    optimized_files.append(optimized_file)
                    used_tokens += file_tokens
                else:
                    # 如果没有空间了，尝试进一步压缩
                    remaining_tokens = available_for_files - used_tokens
                    if remaining_tokens > 50:  # 至少需要 50 tokens 才有意义
                        compressed_file = self._compress_file_content(optimized_file, remaining_tokens)
                        if compressed_file:
                            optimized_files.append(compressed_file)
                    break
        
        return optimized_files
    
    def _estimate_base_prompt_tokens(self) -> int:
        """
        估算基础 prompt 的 token 数（不包括文件内容的部分）
        """
        # 基础的系统消息和提示结构大约需要 200-300 tokens
        return 300
    
    def _estimate_file_tokens(self, file_data: Dict) -> int:
        """
        估算单个文件数据的 token 数
        """
        tokens = 0
        
        # 文件路径
        tokens += self.estimate_tokens(file_data.get('filePath', ''))
        
        # 变更类型描述
        tokens += 10
        
        # diff 内容
        diff_content = file_data.get('diffContent', '')
        tokens += self.estimate_tokens(diff_content)
        
        return tokens
    
    def _optimize_single_file(self, file_data: Dict, available_tokens: int) -> Dict:
        """
        优化单个文件的内容
        """
        if available_tokens < 50:  # 太少的 token 无法有效分析
            return None
        
        optimized_file = file_data.copy()
        diff_content = file_data.get('diffContent', '')
        
        if not diff_content:
            return optimized_file
        
        # 计算当前文件的 token 数
        current_tokens = self._estimate_file_tokens(file_data)
        
        if current_tokens <= available_tokens:
            return optimized_file
        
        # 需要压缩 diff 内容
        target_diff_tokens = available_tokens - 30  # 为文件路径等其他信息预留 30 tokens
        optimized_diff = self._compress_diff_content(diff_content, target_diff_tokens)
        optimized_file['diffContent'] = optimized_diff
        
        return optimized_file
    
    def _compress_file_content(self, file_data: Dict, max_tokens: int) -> Dict:
        """
        进一步压缩文件内容以适应 token 限制
        """
        if max_tokens < 30:
            return None
        
        compressed_file = file_data.copy()
        diff_content = file_data.get('diffContent', '')
        
        # 极度压缩的 diff 内容
        target_diff_tokens = max_tokens - 20
        compressed_diff = self._compress_diff_content(diff_content, target_diff_tokens, aggressive=True)
        compressed_file['diffContent'] = compressed_diff
        
        return compressed_file
    
    def _compress_diff_content(self, diff_content: str, target_tokens: int, aggressive: bool = False) -> str:
        """
        压缩 diff 内容以适应 token 限制
        """
        if not diff_content:
            return diff_content
        
        current_tokens = self.estimate_tokens(diff_content)
        
        if current_tokens <= target_tokens:
            return diff_content
        
        # 计算压缩比例
        compression_ratio = target_tokens / current_tokens
        
        if aggressive:
            # 激进压缩：只保留最重要的变更行
            return self._aggressive_compress_diff(diff_content, target_tokens)
        else:
            # 常规压缩：保留结构，截断内容
            return self._regular_compress_diff(diff_content, compression_ratio)
    
    def _regular_compress_diff(self, diff_content: str, compression_ratio: float) -> str:
        """
        常规 diff 压缩：保留重要信息，截断冗余内容
        """
        lines = diff_content.split('\n')
        
        # 保留的行类型优先级
        priority_patterns = [
            r'^@@.*@@',  # diff header
            r'^\+\+\+',  # file header
            r'^---',     # file header
            r'^\+.*',    # added lines
            r'^-.*',     # removed lines
        ]
        
        important_lines = []
        context_lines = []
        
        for line in lines:
            is_important = any(re.match(pattern, line) for pattern in priority_patterns)
            if is_important:
                important_lines.append(line)
            else:
                context_lines.append(line)
        
        # 计算可以保留多少内容
        total_chars = len('\n'.join(lines))
        target_chars = int(total_chars * compression_ratio)
        
        # 先保留重要行
        result_lines = important_lines[:]
        current_chars = len('\n'.join(result_lines))
        
        # 如果还有空间，添加部分上下文行
        for line in context_lines:
            if current_chars + len(line) + 1 <= target_chars:
                result_lines.append(line)
                current_chars += len(line) + 1
            else:
                break
        
        result = '\n'.join(result_lines)
        
        # 如果压缩后仍然太长，直接截断
        if len(result) > target_chars:
            result = result[:target_chars] + '\n...[内容已截断]'
        
        return result
    
    def _aggressive_compress_diff(self, diff_content: str, target_tokens: int) -> str:
        """
        激进 diff 压缩：只保留最关键的变更信息
        """
        lines = diff_content.split('\n')
        
        # 提取关键信息
        added_lines = [line for line in lines if line.startswith('+') and not line.startswith('+++')]
        removed_lines = [line for line in lines if line.startswith('-') and not line.startswith('---')]
        headers = [line for line in lines if line.startswith('@@')]
        
        # 构建简化的 diff
        summary_parts = []
        
        if headers:
            summary_parts.append(headers[0])  # 第一个 header
        
        # 添加部分新增行
        if added_lines:
            summary_parts.append(f"[新增 {len(added_lines)} 行]")
            summary_parts.extend(added_lines[:3])  # 只保留前3行
            if len(added_lines) > 3:
                summary_parts.append(f"...[还有 {len(added_lines) - 3} 行新增]")
        
        # 添加部分删除行
        if removed_lines:
            summary_parts.append(f"[删除 {len(removed_lines)} 行]")
            summary_parts.extend(removed_lines[:3])  # 只保留前3行
            if len(removed_lines) > 3:
                summary_parts.append(f"...[还有 {len(removed_lines) - 3} 行删除]")
        
        result = '\n'.join(summary_parts)
        
        # 确保不超过目标 token 数
        target_chars = target_tokens * 4  # 近似转换
        if len(result) > target_chars:
            result = result[:target_chars] + '\n...[已极度压缩]'
        
        return result
    
    def validate_prompt_size(self, messages: List[Dict]) -> Tuple[bool, int, str]:
        """
        验证 prompt 大小是否在模型限制内
        
        Returns:
            (is_valid, estimated_tokens, recommendation)
        """
        total_tokens = 0
        
        for message in messages:
            content = message.get('content', '')
            total_tokens += self.estimate_tokens(content)
        
        is_valid = total_tokens <= self.available_tokens
        
        if not is_valid:
            excess_tokens = total_tokens - self.available_tokens
            recommendation = f"需要减少 {excess_tokens} tokens。建议减少文件数量或压缩内容。"
        else:
            remaining_tokens = self.available_tokens - total_tokens
            recommendation = f"token 使用正常，还剩余 {remaining_tokens} tokens。"
        
        return is_valid, total_tokens, recommendation
    
    def get_optimization_stats(self, original_files: List[Dict], optimized_files: List[Dict]) -> Dict:
        """
        获取优化统计信息
        """
        original_count = len(original_files)
        optimized_count = len(optimized_files)
        
        original_tokens = sum(self._estimate_file_tokens(f) for f in original_files)
        optimized_tokens = sum(self._estimate_file_tokens(f) for f in optimized_files)
        
        return {
            'original_file_count': original_count,
            'optimized_file_count': optimized_count,
            'files_removed': original_count - optimized_count,
            'original_tokens': original_tokens,
            'optimized_tokens': optimized_tokens,
            'tokens_saved': original_tokens - optimized_tokens,
            'compression_ratio': optimized_tokens / original_tokens if original_tokens > 0 else 0
        } 