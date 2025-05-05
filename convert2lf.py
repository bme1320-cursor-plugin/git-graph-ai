import os

def convert_line_endings(directory):
    """
    Recursively convert CRLF line endings to LF in all files within the given directory.
    """
    for root, _, files in os.walk(directory):
        for file in files:
            file_path = os.path.join(root, file)
            with open(file_path, 'rb') as f:
                content = f.read()
            
            # Convert CRLF to LF
            new_content = content.replace(b'\r\n', b'\n')
            
            # Only write back if changes were made
            if new_content != content:
                with open(file_path, 'wb') as f:
                    f.write(new_content)
                print(f"Converted line endings in: {file_path}")

# Specify the directory you want to start the conversion from
project_directory = '.'  # Current directory
convert_line_endings(project_directory)