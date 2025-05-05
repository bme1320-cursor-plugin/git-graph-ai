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
        if not data or 'file_diff' not in data or 'file_path' not in data:
            return jsonify({"error": "Missing or invalid data in request (requires file_path and file_diff)"}), 400

        file_path = data['file_path']
        file_diff = data['file_diff']
        # content_before = data.get('content_before') # Optional, could be used for more context
        # content_after = data.get('content_after') # Optional, could be used for more context

        print(f"Received request to analyze diff for: {file_path}")

        # --- OpenAI API Call --- 
        try:
            prompt = f"""
            Analyze the following git diff for the file '{file_path}' and provide a concise, one-sentence summary of the main changes.
            Focus on the *what* and *why* if possible, not just the line numbers.
            Example summary: "Refactored the data loading logic to improve performance."
            
            Diff:
            ```diff
            {file_diff}
            ```
            
            One-sentence summary:"""

            chat_completion = openai_client.chat.completions.create(
                messages=[
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
                model="gpt-3.5-turbo", # Or use "gpt-4" if preferred
                max_tokens=60,
                temperature=0.3,
                n=1
            )

            ai_summary = chat_completion.choices[0].message.content.strip()
            print(f"OpenAI Summary for {file_path}: {ai_summary}")

        except OpenAIError as e:
            print(f"OpenAI API error for {file_path}: {e}")
            ai_summary = f"AI analysis failed: {e}"
        except Exception as e:
            print(f"Unexpected error during OpenAI call for {file_path}: {e}")
            ai_summary = "AI analysis failed due to an unexpected error."
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

if __name__ == '__main__':
    # Note: Use '0.0.0.0' to be accessible from the extension container
    # Use a specific port, e.g., 5111
    app.run(host='0.0.0.0', port=5111, debug=True) # Set debug=False for production 