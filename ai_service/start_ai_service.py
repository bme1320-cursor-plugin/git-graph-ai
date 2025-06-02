#!/usr/bin/env python3
"""
Git Graph AI Service Startup Script
启动Git Graph AI分析服务的脚本

使用方法:
1. 确保已安装依赖: pip install -r requirements.txt
2. 设置OpenAI API密钥环境变量: OPENAI_API_KEY
3. 运行此脚本: python start_ai_service.py
"""

import os
import sys
import subprocess
import platform

def check_requirements():
    """检查运行环境和依赖"""
    print("🔍 检查运行环境...")
    
    # 检查Python版本
    if sys.version_info < (3, 7):
        print("❌ 错误: 需要Python 3.7或更高版本")
        return False
    
    print(f"✅ Python版本: {sys.version}")
    
    # 检查依赖包
    try:
        import flask
        import openai
        print("✅ 依赖包已安装")
    except ImportError as e:
        print(f"❌ 缺少依赖包: {e}")
        print("请运行: pip install -r requirements.txt")
        return False
    
    # 检查API密钥
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("⚠️  警告: 未设置OPENAI_API_KEY环境变量")
        print("AI分析功能将被禁用")
    else:
        print("✅ OpenAI API密钥已设置")
    
    return True

def start_service():
    """启动AI服务"""
    print("\n🚀 启动Git Graph AI分析服务...")
    print("服务地址: http://127.0.0.1:5111")
    print("健康检查: http://127.0.0.1:5111/health")
    print("按 Ctrl+C 停止服务\n")
    
    try:
        # 启动Flask应用
        from server import app
        app.run(host='0.0.0.0', port=5111, debug=False)
    except KeyboardInterrupt:
        print("\n👋 服务已停止")
    except Exception as e:
        print(f"❌ 启动服务时出错: {e}")

def main():
    """主函数"""
    print("=" * 50)
    print("🤖 Git Graph AI 分析服务")
    print("=" * 50)
    
    if not check_requirements():
        sys.exit(1)
    
    start_service()

if __name__ == "__main__":
    main() 