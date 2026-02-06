---
applyTo: '**'
---

# Development Notes

## Heredoc Issues
When using `run_in_terminal`, heredocs (especially multi-line heredocs with `<< 'EOF'`) can cause terminal output corruption and garbled text, making it difficult to see actual command output or errors.

**Solution**: Always use the `replace_string_in_file` or `create_file` tools instead of heredocs when:
- Creating or editing files with more than a few lines
- The content contains special characters or complex formatting
- You need clean, predictable output

This keeps the terminal clean and makes debugging easier.

