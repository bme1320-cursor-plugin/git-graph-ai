#!/bin/bash

# Function to convert CRLF to LF
convert_crlf_to_lf() {
    local file="$1"
    # Use sed to convert CRLF to LF
    sed -i 's/\r$//' "$file"
    echo "Converted: $file"
}

# Export the function so it can be used by find
export -f convert_crlf_to_lf

# Find all .ts files, excluding the .git directory, and convert them
find . -type f -name "*.ts" ! -path "*/.git/*" -exec bash -c 'convert_crlf_to_lf "$0"' {} \;

echo "Conversion complete."