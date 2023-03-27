#!/usr/bin/env node

const fs = require("fs");
const fetch = require("node-fetch");
const { createParser } = require("eventsource-parser");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");
const chalk = require("chalk");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  console.error(chalk.red("Error: OPENAI_API_KEY not set."));
  process.exit(1);
}

async function main() {
  const argv = configureCommandLineArguments();
  const {
    inputFilePath,
    outputFilePath,
    prompt,
    modelName,
    temperature,
    silenceLevel,
  } = argv;

  const inputContent = inputFilePath ? readInputFile(inputFilePath) : "";
  const promptWithInput = constructPromptWithInput(
    prompt,
    inputFilePath,
    inputContent
  );
  if (silenceLevel > 2) {
    console.log(chalk.cyan(promptWithInput));
  }

  const completion = await getLLMCompletion(
    promptWithInput,
    modelName,
    temperature
  );

  if (outputFilePath) {
    const codeBlocks = extractCodeBlocks(completion);

    if (codeBlocks.length > 0) {
      for (const { language, codeBlock } of codeBlocks) {
        if (silenceLevel > 1) {
          console.log(chalk.white("Code block found:"));
          console.log(chalk.green(codeBlock));
        }

        const confirmed = await confirmWriteToFile(language, silenceLevel);
        if (confirmed) {
          fs.writeFileSync(outputFilePath, codeBlock, "utf-8");
          if (silenceLevel > 0) {
            console.log(chalk.white(`Code block written to ${outputFilePath}`));
          }
        } else {
          if (silenceLevel > 0) {
            console.log(chalk.white("Operation aborted by the user."));
          }
        }
      }
    } else {
      if (silenceLevel > 0) {
        console.log(chalk.red("No code block found in the completion."));
      }
    }
  }
}

function configureCommandLineArguments() {
  const args = yargs(hideBin(process.argv))
    .option("p", {
      alias: "prompt",
      type: "string",
      demandOption: true,
      description: "Prompt for LLM chat completion",
    })
    .option("i", {
      alias: "input",
      type: "string",
      description: "Input file path",
    })
    .option("o", {
      alias: "output",
      type: "string",
      description: "Output file path",
    })
    .option("m", {
      alias: "model",
      type: "string",
      default: "gpt-4",
      description: "Model name",
    })
    .option("t", {
      alias: "temperature",
      type: "number",
      default: 0,
      description: "Temperature",
    })
    .option("s", {
      alias: "silence",
      type: "number",
      default: 3,
      description: "Silence level (0-3)",
    })
    .option("h", {
      alias: "help",
      type: "boolean",
      description: "Display help message",
    }).argv;

  if (args.help) {
    displayHelpMessage();
    process.exit(0);
  }

  return {
    inputFilePath: args.i,
    outputFilePath: args.o || args.i,
    prompt: args.p,
    modelName: args.m,
    temperature: args.t,
    silenceLevel: args.s,
  };
}

function displayHelpMessage() {
  console.log(chalk.yellow("Usage: codemancer [options]"));
  console.log("\nOptions:");
  console.log("  -p, --prompt <text>      Prompt for LLM (required)");
  console.log("  -i, --input <path>       Input file path (optional)");
  console.log("  -o, --output <path>      Output file path (optional)");
  console.log("  -m, --model <name>       Model name (default: gpt-4)");
  console.log("  -t, --temperature <num>  Model temperature (default: 0)");
  console.log("  -s, --silence <num>      Silence level (0-3, default: 3)");
  console.log("  -h, --help               Display help message");
}

function readInputFile(inputFilePath) {
  return fs.readFileSync(inputFilePath, "utf-8");
}

function constructPromptWithInput(prompt, inputFilePath, inputContent) {
  if (inputFilePath) {
    return `
${prompt}

### ${inputFilePath}:
\`\`\`
${inputContent}
\`\`\`
`;
  } else {
    return prompt;
  }
}

async function getLLMCompletion(prompt, model, temperature) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${OPENAI_API_KEY}`,
  };

  const body = JSON.stringify({
    model,
    temperature,
    messages: [
      {
        role: "system",
        content: `You are a sophisticated, accurate, and modern AI programming assistant. Whenever you are prompted with a file to modify, you always return the complete code ready to run without any placeholders and including the unchanged code.`,
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    stream: true,
    n: 1,
  });

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    headers,
    method: "POST",
    body,
  });

  return handleAPIResponse(response);
}

function handleAPIResponse(response) {
  const decoder = new TextDecoder();

  return new Promise((resolve, reject) => {
    let completionText = "";

    if (!response.ok) {
      reject(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const parser = createParser((event) => {
      if (event.type !== "event") return;
      if (event.data === "[DONE]") {
        process.stdout.write("\n\n");
        resolve(completionText);
        return;
      }

      try {
        const json = JSON.parse(event.data);
        if (json.choices[0].delta?.role) return;
        const text = json.choices[0].delta?.content || "";
        completionText += text;
        process.stdout.write(chalk.magenta(text));
      } catch (e) {
        reject(e);
      }
    });

    response.body.on("readable", () => {
      let chunk;
      while (null !== (chunk = response.body.read())) {
        parser.feed(decoder.decode(chunk));
      }
    });

    response.body.on("end", () => {
      resolve(completionText);
    });

    response.body.on("error", (err) => {
      reject(err);
    });
  });
}

function extractCodeBlocks(completion) {
  const codeBlockRegex = /^```([a-z]*)?\s^([\s\S]*?)^```/gm;
  const matches = completion.matchAll(codeBlockRegex);
  const codeBlocks = [];

  if (matches) {
    for (const match of matches) {
      codeBlocks.push({ language: match[1], codeBlock: match[2] });
    }
  }

  return codeBlocks;
}

function confirmWriteToFile(language, silenceLevel) {
  return new Promise((resolve) => {
    process.stdin.resume();

    if (silenceLevel === 0) {
      resolve(true);
    }

    process.stdout.write(
      chalk.white(
        `Do you want to write this ${
          language || "unspecified language"
        } code block to the output file? (yes/no): `
      )
    );

    process.stdin.once("data", (data) => {
      const answer = data.toString().trim().toLowerCase();
      resolve(answer === "yes" || answer === "y");
    });
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(chalk.red(err));
    process.exit(1);
  });
