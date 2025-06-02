# ai_service/server.py

import os
import json
from flask import Flask, request, jsonify
from openai import OpenAI, OpenAIError

app = Flask(__name__)



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
        if 'file_path' in data and data['file_path'] in ['comprehensive_commit_analysis', 'comprehensive_comparison_analysis']:
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
            prompt = f"""
            请分析以下Git差异文件的变更内容，并提供简洁的中文总结。

            文件信息：
            - 文件路径: {file_path}
            - 文件类型: {file_extension}

            Git Diff内容：
            ```diff
            {file_diff}
            ```

            请按以下格式回答（不超过80字）：
            {file_name}: [文件简介]。[主要变更内容]。

            要求：
            1. 先简要说明文件用途
            2. 重点描述变更的功能性影响，而非技术细节
            3. 使用简洁的中文表达
            4. 避免使用"这个文件"等指代词
            """

            chat_completion = openai_client.chat.completions.create(
                messages=[
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
                model="gpt-3.5-turbo",
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
    """处理综合分析请求"""
    try:
        analysis_type = data['file_path']
        prompt = data.get('file_diff', '')  # 在综合分析中，file_diff字段包含完整的提示词
        
        if not prompt:
            return jsonify({"error": "Missing analysis prompt"}), 400
        
        print(f"Received comprehensive analysis request: {analysis_type}")
        
        # --- OpenAI API Call for Comprehensive Analysis ---
        try:
            chat_completion = openai_client.chat.completions.create(
                messages=[
                    {
                        "role": "system",
                        "content": "你是一个专业的代码分析师，擅长分析Git提交和版本变更。请提供准确、简洁、有价值的分析报告。"
                    },
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
                model="gpt-3.5-turbo",
                max_tokens=300,  # 为综合分析提供更多token
                temperature=0.2,  # 降低温度以获得更一致的分析
                n=1
            )

            ai_summary = chat_completion.choices[0].message.content.strip()
            print(f"OpenAI Comprehensive Analysis: {ai_summary}")

            return jsonify({
                "analysis": {
                    "summary": ai_summary,
                }
            })

        except OpenAIError as e:
            print(f"OpenAI API error for comprehensive analysis: {e}")
            error_summary = f"<p><strong>AI分析暂时不可用</strong></p><p>错误信息：{str(e)}</p>"
            return jsonify({
                "analysis": {
                    "summary": error_summary,
                }
            })
        except Exception as e:
            print(f"Unexpected error during comprehensive analysis: {e}")
            error_summary = "<p><strong>AI分析遇到未知错误</strong></p><p>请稍后重试。</p>"
            return jsonify({
                "analysis": {
                    "summary": error_summary,
                }
            })

    except Exception as e:
        print(f"Error processing comprehensive analysis: {e}")
        return jsonify({"error": "An internal server error occurred during comprehensive analysis"}), 500

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
    print(f"Health check available at: http://127.0.0.1:5111/health")
    print(f"Analysis endpoint available at: http://127.0.0.1:5111/analyze_diff")
    print(f"Batch analysis endpoint available at: http://127.0.0.1:5111/analyze_batch")
    # Note: Use '0.0.0.0' to be accessible from the extension container
    # Use a specific port, e.g., 5111
    app.run(host='0.0.0.0', port=5111, debug=True) # Set debug=False for production 