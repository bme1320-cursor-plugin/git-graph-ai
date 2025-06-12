# ai_service/server.py

import os
import json
from flask import Flask, request, jsonify
from flask_cors import CORS
import prompt_config as prompts
from model_providers import ModelManager

app = Flask(__name__)
CORS(app)

# --- 初始化AI模型管理器 ---
# 从环境变量读取首选的AI提供商，默认使用deepseek-v3
preferred_ai_provider = os.environ.get("PREFERRED_AI_PROVIDER", "deepseek-v3")
model_manager = ModelManager(preferred_provider=preferred_ai_provider)
print(f"🚀 AI Service started with preferred provider: {preferred_ai_provider}")
# ------------------------------------

@app.route('/health', methods=['GET'])
def health_check():
    """健康检查端点"""
    if model_manager.is_available():
        provider_info = model_manager.get_current_provider().get_provider_name()
        return jsonify({
            "status": "healthy", 
            "ai_service": "available",
            "current_provider": provider_info
        }), 200
    else:
        return jsonify({
            "status": "degraded", 
            "ai_service": "unavailable",
            "current_provider": None
        }), 200

@app.route('/providers', methods=['GET'])
def get_providers():
    """获取所有AI提供商的状态信息"""
    try:
        status = model_manager.get_provider_status()
        return jsonify(status), 200
    except Exception as e:
        return jsonify({"error": f"Failed to get provider status: {str(e)}"}), 500

@app.route('/providers/switch', methods=['POST'])
def switch_provider():
    """切换AI提供商"""
    try:
        data = request.get_json()
        if not data or 'provider' not in data:
            return jsonify({"error": "Missing 'provider' in request"}), 400
        
        provider_name = data['provider']
        new_provider = model_manager.switch_provider(provider_name)
        
        return jsonify({
            "message": f"Successfully switched to {new_provider}",
            "current_provider": new_provider
        }), 200
        
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"Failed to switch provider: {str(e)}"}), 500

@app.route('/analyze_diff', methods=['POST'])
def analyze_diff():
    """Analyzes the diff data using available AI provider."""
    if not model_manager.is_available():
        return jsonify({
            "analysis": {
                "summary": "AI分析服务暂时不可用，请检查AI服务配置。",
            }
        })

    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "Missing data in request"}), 400
        
        # 检查是否是综合分析请求
        if 'analysis_context' in data and data['analysis_context'] in ['comprehensive_commit_analysis', 'comprehensive_comparison_analysis', 'comprehensive_uncommitted_analysis']:
            return handle_comprehensive_analysis(data)
        
        # 原有的单文件分析逻辑
        if 'file_diff' not in data or 'analysis_context' not in data:
            return jsonify({"error": "Missing or invalid data in request (requires analysis_context and file_diff)"}), 400
        
        analysis_context = data['analysis_context']
        file_diff = data['file_diff']
        
        # 检查diff内容是否为空
        if not file_diff or file_diff.strip() == '':
            return jsonify({
                "analysis": {
                    "summary": "文件无实质性变更。"
                }
            })

        print(f"Received request to analyze diff for: {analysis_context}")
        analysis_context = analysis_context.strip()
        
        # 获取文件类型和扩展名（如果是文件路径的话）
        file_extension = analysis_context.split('.')[-1].lower() if '.' in analysis_context else ''
        context_name = analysis_context.split('/')[-1]
        
        # --- AI API Call --- 
        try:
            # 改进的提示词，更加具体和有针对性
            prompt = prompts.build_analyze_diff_prompt(analysis_context, file_extension, context_name, file_diff)

            # 使用模型管理器调用AI API
            ai_summary = model_manager.chat_completion(
                messages=[
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
                max_tokens=100,
                temperature=0.3
            )

            print(f"AI Summary for {analysis_context}: {ai_summary}")

        except Exception as e:
            print(f"AI API error for {analysis_context}: {e}")
            ai_summary = f"AI分析暂时不可用：{str(e)}"
        # -----------------------

        return jsonify({
            "analysis": {
                "summary": ai_summary,
            }
        })

    except json.JSONDecodeError:
        return jsonify({"error": "Invalid JSON format"}), 400
    except Exception as e:
        print(f"Error processing request: {e}")
        return jsonify({"error": "An internal server error occurred"}), 500

def handle_comprehensive_analysis(data):
    """处理通用的综合性分析请求"""
    try:
        analysis_context_marker = data.get('analysis_context')
        payload_str = data.get('file_diff', '{}')
        payload = json.loads(payload_str)

        # 🚀 新增：获取当前模型名称以便优化 prompt
        current_model_name = 'deepseek-v3'  # 默认值
        if model_manager.current_provider:
            provider_name = model_manager.current_provider.get_provider_name()
            if 'OpenAI' in provider_name and 'gpt-4.1' in provider_name.lower():
                current_model_name = 'gpt-4.1-mini' if 'mini' in provider_name.lower() else 'gpt-4.1'
            elif 'Deepseek' in provider_name:
                if 'deepseek-r1' in provider_name.lower():
                    current_model_name = 'deepseek-r1'
                else:
                    current_model_name = 'deepseek-v3'

        prompt_builders = {
            'comprehensive_commit_analysis': lambda payload: prompts.build_comprehensive_commit_analysis_prompt(payload, current_model_name),
            'comprehensive_uncommitted_analysis': lambda payload: prompts.build_comprehensive_uncommitted_analysis_prompt(payload, current_model_name),
            'comprehensive_comparison_analysis': lambda payload: prompts.build_comprehensive_comparison_prompt(payload, current_model_name)
        }

        builder = prompt_builders.get(analysis_context_marker)
        
        if not builder:
            return jsonify({"error": f"Invalid comprehensive analysis type: {analysis_context_marker}"}), 400
            
        prompt = builder(payload)
        
        print(f"🔧 Using model-optimized prompt for {current_model_name}, context: {analysis_context_marker}")
        
        # 使用模型管理器进行分析
        ai_summary = model_manager.chat_completion(
            messages=[
                {
                    "role": "system",
                    "content": "你是一个专业的Git代码分析助手。请根据用户的要求，提供精准、专业的代码变更分析。如果要求HTML格式，请确保返回有效的HTML片段。"
                },
                {
                    "role": "user",
                    "content": prompt,
                }
            ],
            max_tokens=800,
            temperature=0.3
        )
        
        return jsonify({
            "analysis": {
                "summary": ai_summary,
            }
        })
    except (json.JSONDecodeError, KeyError) as e:
        print(f"Error parsing comprehensive analysis payload: {e}")
        return jsonify({"error": "Invalid payload for comprehensive analysis"}), 400
    except Exception as e:
        print(f"AI API error during comprehensive analysis: {e}")
        return jsonify({
            "analysis": {
                "summary": "AI分析时遇到API错误。",
            }
        })

def generate_fallback_analysis(error_message="分析时发生未知错误。"):
    """生成降级分析响应"""
    return json.dumps({
        "summary": error_message,
        "evolutionPattern": "文件演进模式分析基于提交历史，显示开发活跃度和变更频率。",
        "keyChanges": [
            "代码结构调整",
            "功能实现优化",
            "性能改进措施"
        ],
        "recommendations": [
            "持续关注代码质量",
            "定期进行重构优化",
            "加强文档维护"
        ]
    }, ensure_ascii=False)

@app.route('/analyze_file_history', methods=['POST'])
def analyze_file_history():
    """专门处理文件历史分析的端点"""
    if not model_manager.is_available():
        return jsonify({
            "analysis": {
                "summary": "AI分析服务暂时不可用，请检查AI服务配置。",
            }
        })

    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "Missing data in request"}), 400
        
        # 接收原始数据负载，而不是预构建的提示
        payload_str = data.get('file_diff', '{}') 
        payload = json.loads(payload_str)
        analysis_context = data.get('analysis_context', '未知文件')

        if not payload.get('commits'):
            return jsonify({"error": "Missing commits data for file history analysis"}), 400
        
        print(f"Received file history analysis request for: {analysis_context}")
        
        # 在后端构建提示
        base_prompt = prompts.build_file_history_analysis_prompt(payload)
        
        # 优化后的文件历史分析提示词
        enhanced_prompt = prompts.build_enhanced_file_history_prompt(base_prompt)

        try:
            ai_summary = model_manager.chat_completion(
                messages=[
                    {
                        "role": "system",
                        "content": "你是一个专业的代码演进分析师。请严格按照用户要求的JSON格式回答，不要添加任何额外的文本或格式化。"
                    },
                    {
                        "role": "user",
                        "content": enhanced_prompt,
                    }
                ],
                max_tokens=400,
                temperature=0.2
            )

            print(f"File History Analysis Raw Response for {analysis_context}: {ai_summary}")

            # 尝试验证返回的是有效的JSON
            try:
                test_parse = json.loads(ai_summary)
                if not all(key in test_parse for key in ['summary', 'evolutionPattern', 'keyChanges', 'recommendations']):
                    raise ValueError("Missing required fields in AI response")
            except (json.JSONDecodeError, ValueError):
                print(f"Invalid JSON response for {analysis_context}, using fallback")
                ai_summary = generate_fallback_analysis("AI返回的数据格式不正确，已使用默认分析。")

        except Exception as e:
            print(f"AI API error for file history analysis {analysis_context}: {e}")
            ai_summary = generate_fallback_analysis(f"AI分析时发生错误：{str(e)}")

        return jsonify({
            "analysis": {
                "summary": ai_summary,
            }
        })

    except (json.JSONDecodeError, KeyError) as e:
        print(f"Error parsing file history analysis payload: {e}")
        return jsonify({"error": "Invalid payload for file history analysis"}), 400
    except Exception as e:
        print(f"Unexpected error during file history analysis: {e}")
        return jsonify({"error": "An internal server error occurred"}), 500

@app.route('/analyze_file_version_comparison', methods=['POST'])
def analyze_file_version_comparison():
    """处理文件版本比较分析的端点"""
    if not model_manager.is_available():
        return jsonify({
            "analysis": {
                "summary": "AI分析服务暂时不可用，请检查AI服务配置。",
            }
        })

    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "Missing data in request"}), 400
        
        # 接收原始数据负载
        payload_str = data.get('file_diff', '{}') 
        payload = json.loads(payload_str)
        analysis_context = data.get('analysis_context', '未知文件')

        if not payload.get('contentBefore') and not payload.get('contentAfter'):
            return jsonify({"error": "Missing file content data for version comparison"}), 400
        
        print(f"Received file version comparison request for: {analysis_context}")
        
        # 构建版本比较分析提示
        prompt = prompts.build_file_version_comparison_prompt(payload)

        try:
            ai_summary = model_manager.chat_completion(
                messages=[
                    {
                        "role": "system",
                        "content": "你是一个专业的代码版本比较分析师。请提供精准、专业的版本差异分析。"
                    },
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
                max_tokens=300,
                temperature=0.3
            )

            print(f"File Version Comparison Analysis for {analysis_context}: {ai_summary}")

        except Exception as e:
            print(f"AI API error for file version comparison {analysis_context}: {e}")
            ai_summary = f"AI分析时发生错误：{str(e)}"

        return jsonify({
            "analysis": {
                "summary": ai_summary,
            }
        })

    except (json.JSONDecodeError, KeyError) as e:
        print(f"Error parsing file version comparison payload: {e}")
        return jsonify({"error": "Invalid payload for file version comparison"}), 400
    except Exception as e:
        print(f"Unexpected error during file version comparison: {e}")
        return jsonify({"error": "An internal server error occurred"}), 500

@app.route('/analyze_batch', methods=['POST'])
def analyze_batch():
    """批量分析多个文件的差异"""
    if not model_manager.is_available():
        return jsonify({
            "analyses": [],
            "summary": "AI分析服务暂时不可用，请检查AI服务配置。"
        })

    try:
        data = request.get_json()
        if not data or 'files' not in data:
            return jsonify({"error": "Missing 'files' in request"}), 400
        
        files = data['files']
        if not isinstance(files, list):
            return jsonify({"error": "'files' must be an array"}), 400
        
        analyses = []
        
        for file_data in files:
            if 'analysis_context' not in file_data or 'file_diff' not in file_data:
                continue
            
            analysis_context = file_data['analysis_context']
            file_diff = file_data['file_diff']
            
            # 跳过空的diff
            if not file_diff or file_diff.strip() == '':
                analyses.append({
                    "analysis_context": analysis_context,
                    "analysis": {
                        "summary": "文件无实质性变更。"
                    }
                })
                continue
            
            try:
                # 获取文件类型和扩展名
                file_extension = analysis_context.split('.')[-1].lower() if '.' in analysis_context else ''
                context_name = analysis_context.split('/')[-1]
                
                # 构建提示词
                prompt = prompts.build_analyze_diff_prompt(analysis_context, file_extension, context_name, file_diff)
                
                # AI分析
                ai_summary = model_manager.chat_completion(
                    messages=[
                        {
                            "role": "user",
                            "content": prompt,
                        }
                    ],
                    max_tokens=100,
                    temperature=0.3
                )
                
                analyses.append({
                    "analysis_context": analysis_context,
                    "analysis": {
                        "summary": ai_summary,
                    }
                })
                
            except Exception as e:
                print(f"Error analyzing {analysis_context}: {e}")
                analyses.append({
                    "analysis_context": analysis_context,
                    "analysis": {
                        "summary": f"分析失败：{str(e)}"
                    }
                })
        
        return jsonify({
            "analyses": analyses,
            "total_files": len(files),
            "analyzed_files": len(analyses)
        })

    except Exception as e:
        print(f"Error in batch analysis: {e}")
        return jsonify({"error": "An internal server error occurred"}), 500

if __name__ == '__main__':
    print("🎯 Starting AI Analysis Service...")
    print(f"🤖 Using AI Provider: {model_manager.get_current_provider().get_provider_name() if model_manager.is_available() else 'None'}")
    app.run(host='0.0.0.0', port=5111, debug=True) 