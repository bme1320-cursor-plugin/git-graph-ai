# ai_service/server.py

import os
import json
from flask import Flask, request, jsonify
from flask_cors import CORS
from openai import OpenAI, OpenAIError
import prompt_config as prompts

app = Flask(__name__)

# 配置CORS以允许跨域访问
# CORS(app, origins=['*'])  # 生产环境建议指定具体域名

# --- OpenAI Client Initialization ---
openai_client = None
api_key = os.environ.get("OPENAI_API_KEY")

if api_key:
    try:
        openai_client = OpenAI(api_key=api_key)
        print("OpenAI client initialized successfully.")
    except Exception as e:
        print(f"Error initializing OpenAI client: {e}")
else:
    print("Warning: OPENAI_API_KEY environment variable not set. AI analysis will be disabled.")
# ------------------------------------

@app.route('/health', methods=['GET'])
def health_check():
    """健康检查端点"""
    if openai_client:
        return jsonify({"status": "healthy", "ai_service": "available"}), 200
    else:
        return jsonify({"status": "degraded", "ai_service": "unavailable"}), 200

@app.route('/analyze_diff', methods=['POST'])
def analyze_diff():
    """Analyzes the diff data using OpenAI API if available."""
    if not openai_client:
        return jsonify({
            "analysis": {
                "summary": "AI analysis disabled: OPENAI_API_KEY not configured.",
            }
        })

    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "Missing data in request"}), 400
        
        # 检查是否是综合分析请求
        if 'file_path' in data and data['file_path'] in ['comprehensive_commit_analysis', 'comprehensive_comparison_analysis', 'comprehensive_uncommitted_analysis']:
            return handle_comprehensive_analysis(data)
        
        # 原有的单文件分析逻辑
        if 'file_diff' not in data or 'file_path' not in data:
            return jsonify({"error": "Missing or invalid data in request (requires file_path and file_diff)"}), 400
        
        file_path = data['file_path']
        file_diff = data['file_diff']
        
        # 检查diff内容是否为空
        if not file_diff or file_diff.strip() == '':
            return jsonify({
                "analysis": {
                    "summary": "文件无实质性变更。"
                }
            })

        print(f"Received request to analyze diff for: {file_path}")
        file_path = file_path.strip()
        
        # 获取文件类型和扩展名
        file_extension = file_path.split('.')[-1].lower() if '.' in file_path else ''
        file_name = file_path.split('/')[-1]
        
        # --- OpenAI API Call --- 
        try:
            # 改进的提示词，更加具体和有针对性
            prompt = prompts.build_analyze_diff_prompt(file_path, file_extension, file_name, file_diff)

            chat_completion = openai_client.chat.completions.create(
                messages=[
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
                model="gpt-4.1-mini",
                max_tokens=100,  # 增加token限制以获得更详细的分析
                temperature=0.3,
                n=1
            )

            ai_summary = chat_completion.choices[0].message.content.strip()
            print(f"OpenAI Summary for {file_path}: {ai_summary}")

        except OpenAIError as e:
            print(f"OpenAI API error for {file_path}: {e}")
            ai_summary = f"AI分析暂时不可用：{str(e)}"
        except Exception as e:
            print(f"Unexpected error during OpenAI call for {file_path}: {e}")
            ai_summary = "AI分析遇到未知错误，请稍后重试。"
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
        file_path_marker = data.get('file_path')
        payload_str = data.get('file_diff', '{}')
        payload = json.loads(payload_str)

        prompt_builders = {
            'comprehensive_commit_analysis': prompts.build_comprehensive_commit_analysis_prompt,
            'comprehensive_uncommitted_analysis': prompts.build_comprehensive_uncommitted_analysis_prompt,
            'comprehensive_comparison_analysis': prompts.build_comprehensive_comparison_prompt
        }

        builder = prompt_builders.get(file_path_marker)
        
        if not builder:
            return jsonify({"error": f"Invalid comprehensive analysis type: {file_path_marker}"}), 400
            
        prompt = builder(payload)
        
        # 使用OpenAI API进行分析
        chat_completion = openai_client.chat.completions.create(
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
            model="gpt-4.1-mini",
            max_tokens=800,  # 增加token以适应更复杂的分析
            temperature=0.3,
            n=1
        )
        ai_summary = chat_completion.choices[0].message.content.strip()
        
        return jsonify({
            "analysis": {
                "summary": ai_summary,
            }
        })
    except (json.JSONDecodeError, KeyError) as e:
        print(f"Error parsing comprehensive analysis payload: {e}")
        return jsonify({"error": "Invalid payload for comprehensive analysis"}), 400
    except OpenAIError as e:
        print(f"OpenAI API error during comprehensive analysis: {e}")
        return jsonify({
            "analysis": {
                "summary": "AI分析时遇到API错误。",
            }
        })
    except Exception as e:
        print(f"Unexpected error during comprehensive analysis: {e}")
        return jsonify({"error": "An internal server error occurred"}), 500

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
    if not openai_client:
        return jsonify({
            "analysis": {
                "summary": "AI分析服务暂时不可用，请检查OpenAI API配置。",
            }
        })

    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "Missing data in request"}), 400
        
        # 接收原始数据负载，而不是预构建的提示
        payload_str = data.get('file_diff', '{}') 
        payload = json.loads(payload_str)
        file_path = payload.get('filePath', '未知文件')

        if not payload.get('commits'):
            return jsonify({"error": "Missing commits data for file history analysis"}), 400
        
        print(f"Received file history analysis request for: {file_path}")
        
        # 在后端构建提示
        base_prompt = prompts.build_file_history_analysis_prompt(payload)
        
        # 优化后的文件历史分析提示词
        enhanced_prompt = prompts.build_enhanced_file_history_prompt(base_prompt)

        try:
            chat_completion = openai_client.chat.completions.create(
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
                model="gpt-4.1-mini",
                max_tokens=400,
                temperature=0.2,
                n=1
            )

            ai_summary = chat_completion.choices[0].message.content.strip()
            print(f"File History Analysis Raw Response for {file_path}: {ai_summary}")

            # 尝试验证返回的是有效的JSON
            try:
                test_parse = json.loads(ai_summary)
                if not all(key in test_parse for key in ['summary', 'evolutionPattern', 'keyChanges', 'recommendations']):
                    raise ValueError("Missing required fields in AI response")
                print(f"File History Analysis JSON validation passed for {file_path}")
            except (json.JSONDecodeError, ValueError) as parse_error:
                print(f"AI returned invalid JSON for {file_path}, using fallback: {parse_error}")
                ai_summary = generate_fallback_analysis(f"AI分析遇到未知错误，请稍后重试。")

            return jsonify({
                "analysis": {
                    "summary": ai_summary,
                }
            })

        except OpenAIError as e:
            print(f"OpenAI API error for file history analysis: {e}")
            fallback_analysis = generate_fallback_analysis(f"AI分析暂时不可用：{str(e)}")
            return jsonify({
                "analysis": {
                    "summary": fallback_analysis,
                }
            })
        except Exception as e:
            print(f"Unexpected error during file history analysis: {e}")
            fallback_analysis = generate_fallback_analysis("AI分析遇到未知错误，请稍后重试。")
            return jsonify({
                "analysis": {
                    "summary": fallback_analysis,
                }
            })

    except Exception as e:
        print(f"Error processing file history analysis: {e}")
        return jsonify({"error": "An internal server error occurred"}), 500

@app.route('/analyze_file_version_comparison', methods=['POST'])
def analyze_file_version_comparison():
    """专门处理文件版本比较分析的端点"""
    if not openai_client:
        return jsonify({
            "analysis": {
                "summary": "AI分析服务暂时不可用，请检查OpenAI API配置。",
            }
        })

    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "Missing data in request"}), 400
        
        # 接收原始数据负载，而不是预构建的提示
        payload_str = data.get('file_diff', '{}')
        payload = json.loads(payload_str)
        file_path = payload.get('filePath', '未知文件')
        
        if not payload.get('diffContent'):
            return jsonify({"error": "Missing diffContent for file version comparison"}), 400
        
        print(f"Received file version comparison analysis request for: {file_path}")
        
        # 在后端构建提示
        prompt = prompts.build_file_version_comparison_prompt(payload)
        
        try:
            chat_completion = openai_client.chat.completions.create(
                messages=[
                    {
                        "role": "system",
                        "content": "你是一个专业的代码版本比较分析师。请严格按照用户要求的JSON格式回答，不要添加任何额外的文本或格式化。"
                    },
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
                model="gpt-4.1-mini",
                max_tokens=500,
                temperature=0.3,
                n=1
            )

            ai_summary = chat_completion.choices[0].message.content.strip()
            print(f"File Version Comparison Analysis Raw Response for {file_path}: {ai_summary}")

            # 尝试验证返回的是有效的JSON
            try:
                test_parse = json.loads(ai_summary)
                required_fields = ['summary', 'changeType', 'impactAnalysis', 'keyModifications', 'recommendations']
                if not all(key in test_parse for key in required_fields):
                    raise ValueError("Missing required fields in AI response")
                print(f"File Version Comparison Analysis JSON validation passed for {file_path}")
            except (json.JSONDecodeError, ValueError) as parse_error:
                print(f"AI returned invalid JSON for {file_path}, using fallback: {parse_error}")
                ai_summary = generate_fallback_analysis(f"AI分析遇到未知错误，请稍后重试。")

            return jsonify({
                "analysis": {
                    "summary": ai_summary,
                }
            })

        except OpenAIError as e:
            print(f"OpenAI API error for file version comparison analysis: {e}")
            fallback_analysis = generate_fallback_analysis(f"AI分析暂时不可用：{str(e)}")
            return jsonify({
                "analysis": {
                    "summary": fallback_analysis,
                }
            })
        except Exception as e:
            print(f"Unexpected error during file version comparison analysis: {e}")
            fallback_analysis = generate_fallback_analysis("AI分析遇到未知错误，请稍后重试。")
            return jsonify({
                "analysis": {
                    "summary": fallback_analysis,
                }
            })

    except Exception as e:
        print(f"Error processing file version comparison analysis: {e}")
        return jsonify({"error": "An internal server error occurred"}), 500

@app.route('/analyze_batch', methods=['POST'])
def analyze_batch():
    """批量分析多个文件的差异"""
    if not openai_client:
        return jsonify({
            "error": "AI analysis disabled: OPENAI_API_KEY not configured."
        }), 503

    try:
        data = request.get_json()
        if not data or 'files' not in data:
            return jsonify({"error": "Missing files array in request"}), 400
        
        files = data['files']
        if not isinstance(files, list) or len(files) == 0:
            return jsonify({"error": "Files must be a non-empty array"}), 400
        
        # 限制批量处理的文件数量
        if len(files) > 10:
            return jsonify({"error": "Too many files in batch (max 10)"}), 400
        
        results = []
        for file_data in files:
            if 'file_path' not in file_data or 'file_diff' not in file_data:
                results.append({
                    "file_path": file_data.get('file_path', 'unknown'),
                    "analysis": None,
                    "error": "Missing file_path or file_diff"
                })
                continue
            
            # 重用单文件分析逻辑
            try:
                # 这里可以调用analyze_diff的核心逻辑
                # 为了简化，我们直接返回一个简单的分析
                file_path = file_data['file_path']
                file_name = file_path.split('/')[-1]
                
                results.append({
                    "file_path": file_path,
                    "analysis": {
                        "summary": f"{file_name}: 文件已修改，包含代码变更。"
                    },
                    "error": None
                })
            except Exception as e:
                results.append({
                    "file_path": file_data['file_path'],
                    "analysis": None,
                    "error": str(e)
                })
        
        return jsonify({"results": results})
        
    except Exception as e:
        print(f"Error processing batch request: {e}")
        return jsonify({"error": "An internal server error occurred"}), 500

if __name__ == '__main__':
    print("Starting AI Analysis Server...")
    print("="*50)
    print("🔧 服务器配置:")
    print(f"   - 本地访问: http://127.0.0.1:5111")
    print(f"   - 局域网访问: http://[你的内网IP]:5111") 
    print(f"   - 外网访问: http://[你的公网IP]:5111")
    print("="*50)
    print("📍 可用端点:")
    print(f"   - 健康检查: /health")
    print(f"   - 差异分析: /analyze_diff") 
    print(f"   - 文件历史: /analyze_file_history")
    print(f"   - 版本比较: /analyze_file_version_comparison")
    print(f"   - 批量分析: /analyze_batch")
    print("="*50)
    print("⚠️  安全提示:")
    print("   - 当前配置允许所有IP访问")
    print("   - 生产环境请配置防火墙规则")
    print("   - 建议设置API访问限制")
    print("="*50)
    
    # 获取并显示本机IP地址
    try:
        import socket
        hostname = socket.gethostname()
        local_ip = socket.gethostbyname(hostname)
        print(f"🌐 本机IP地址: {local_ip}")
        print(f"   局域网访问链接: http://{local_ip}:5111/health")
    except:
        print("🌐 无法获取本机IP，请手动查看")
    
    print("="*50)
    print("🚀 服务器启动中...")
    
    # Note: Use '0.0.0.0' to be accessible from the extension container
    # Use a specific port, e.g., 5111
    app.run(host='0.0.0.0', port=5111, debug=True)  # 生产环境建议debug=False 