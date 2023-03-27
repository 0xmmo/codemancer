# Codemancer

Codemancer is a command line program that uses OpenAI's API to generate code based on a given prompt and input file. It is installable via npm and requires an OpenAI API key.

<GIF>

## Installation

```bash
npm install -g codemancer
```

## Usage

To use Codemancer, you need to set the `OPENAI_API_KEY` environment variable with your OpenAI API key.

```bash
export OPENAI_API_KEY=your_api_key_here
```

> ⚠️ `codemancer` is most useful when using GPT-4, and by will use it by default. If you do not have access yet, you can specify the `-m "gpt-3.5-turbo"` argument, but code generations will be much less reliable.

### Reading and writing to the same file

Modify a file in-place based on a prompt, useful for iterating on functionality, addressing review comments, or refactoring.

```bash
codemancer -i input_file_path -p "break recipe/<id> route into recipe/<id>/info and recipe/<id>/image"
```

This command will read the content of the input file and send it along with the prompt to the OpenAI API. The generated code will be displayed in the terminal and, after confirmation, written back to the same file.

### Writing to a different file

Useful for generating a new file with similar functionality, readmes, or interface definitions (e.g. rpc).

```bash
codemancer -i input_file_path -o output_file_path -p "extract inlined types into interfaces in a separate file"
```

### Customizing model and temperature

```bash
codemancer -i input_file_path -m gpt-3.5-turbo -t 0.5 -p "change all variable names to obscure animals"
```

## License

GPL License
