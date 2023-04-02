#!/usr/bin/env node

const fs = require("fs");
const fetch = require("node-fetch");
const { createParser } = require("eventsource-parser");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");
const chalk = require("chalk");

let OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  OPENAI_API_URL = "https://api.codemancer.codes/v1/chat/completions";
  console.error(
    chalk.red(
      "Warning: OPENAI_API_KEY not set. Using free codemancer OpenAI proxy, which is slower and rate limited."
    )
  );
}

async function main() {
  const argv = configureCommandLineArguments();
  const {
    inputFilePaths,
    outputFilePath,
    prompt,
    modelName,
    temperature,
    verbosity,
  } = argv;

  const inputContents = inputFilePaths.map((path) => readInputFile(path));
  const promptWithInput = constructPromptWithInput(
    prompt,
    inputFilePaths,
    inputContents
  );
  if (verbosity > 2) {
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
        if (verbosity > 1) {
          console.log(chalk.white("Code block found:"));
          console.log(chalk.green(codeBlock));
        }

        const confirmed = await confirmWriteToFile(language, verbosity);
        if (confirmed) {
          fs.writeFileSync(outputFilePath, codeBlock, "utf-8");
          if (verbosity > 0) {
            console.log(chalk.white(`Code block written to ${outputFilePath}`));
          }
        } else {
          if (verbosity > 0) {
            console.log(chalk.white("Operation aborted by the user."));
          }
        }
      }
    } else {
      if (verbosity > 0) {
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
      description: "Prompt for LLM completion",
    })
    .option("i", {
      alias: "input",
      type: "string",
      description: "Input file paths, separated by commas",
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
      description: "Temperature (0-2)",
    })
    .option("s", {
      alias: "verbosity",
      type: "number",
      default: 2,
      description: "Verbosity (0-3)",
    }).argv;

  const inputFilePaths = args.i ? args.i.split(",") : [];
  const outputFilePath = args.o || inputFilePaths[0];

  return {
    inputFilePaths,
    outputFilePath,
    prompt: args.p,
    modelName: args.m,
    temperature: args.t,
    verbosity: args.s,
  };
}

function readInputFile(inputFilePath) {
  return fs.readFileSync(inputFilePath, "utf-8");
}

function constructPromptWithInput(prompt, inputFilePaths, inputContents) {
  let promptWithInput = prompt;

  for (let i = 0; i < inputFilePaths.length; i++) {
    promptWithInput += `
### ${inputFilePaths[i]}:
\`\`\`
${inputContents[i]}
\`\`\`
`;
  }

  return promptWithInput;
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
        content: `You are a sophisticated, accurate, and modern AI programming assistant. Whenever you are prompted with a file to modify, you always return the complete code in a fenced code block ready to run without any placeholders and including the unchanged code.`,
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    stream: true,
    n: 1,
  });

  const response = await fetch(OPENAI_API_URL, {
    headers,
    method: "POST",
    body,
  });

  return handleAPIResponse(response);
}

async function handleAPIResponse(response) {
  const decoder = new TextDecoder();

  return new Promise(async (resolve, reject) => {
    let completionText = "";

    if (!response.ok) {
      const responseBody = await response.text();
      reject(
        `API error: ${response.status} ${response.statusText}\nResponse body: ${responseBody}`
      );
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

function confirmWriteToFile(language, verbosity) {
  return new Promise((resolve) => {
    process.stdin.resume();

    if (verbosity === 0) {
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
