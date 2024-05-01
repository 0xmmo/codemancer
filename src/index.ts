#!/usr/bin/env node

import fs from "fs";
import fetch from "node-fetch";
import { createParser } from "eventsource-parser";
import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import chalk from "chalk";
import { exec } from "child_process";

const modifyInstruction = `You are a sophisticated, accurate, and modern AI programming assistant. Whenever you are prompted with a file to modify, you always return the complete code in a fenced code block ready to run without any placeholders and including the unchanged code.`;
const identifyPlaceholdersInstruction = `Below is the code output by an AI programming assistant. This code may contain one or multiple placeholders that the AI creates to be filled in by the user. Please identify and list all the placeholders in this code. Examples: "Rest of the code remains the same..." OR "YOUR CODE HERE" OR "Existing function code ..."`;

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
  const argv = await configureCommandLineArguments();
  const {
    inputFilePaths,
    outputFilePaths,
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
    modifyInstruction,
    promptWithInput,
    modelName,
    temperature
  );

  if (outputFilePaths.length > 0) {
    const codeBlocks = await extractCodeBlocks(completion, modelName);

    if (codeBlocks.length > 0) {
      let cbidx = 0;
      for (const { language, codeBlock } of codeBlocks) {
        const outputFilePath = outputFilePaths[cbidx] || outputFilePaths[0];

        if (verbosity > 1) {
          console.log(chalk.white("Code block found:"));
          console.log(chalk.green(codeBlock));
        }

        const confirmed = await handleUserInput(
          language,
          verbosity,
          language === "bash" ? "the command line" : outputFilePath
        );

        if (confirmed) {
          const newPath = confirmed === true ? outputFilePath : confirmed;

          if (language === "bash") {
            await runTerminalCommand(codeBlock, verbosity);
          } else {
            writeCodeBlockToFile(newPath, codeBlock, verbosity);
          }
        } else {
          if (verbosity > 0) {
            console.log(chalk.white("Operation aborted by the user."));
          }
        }

        cbidx++;
      }
    } else {
      if (verbosity > 0) {
        console.log(chalk.red("No code block found in the completion."));
      }
    }
  }
}

async function configureCommandLineArguments(): Promise<{
  inputFilePaths: string[];
  outputFilePaths: string[];
  prompt: string;
  modelName: string;
  temperature: number;
  verbosity: number;
}> {
  const args = await yargs(hideBin(process.argv))
    .option("p", {
      alias: "prompt",
      type: "string",
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
      description: "Output file paths, separated by commas",
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

  const maybeInputs = args._[0].toString();
  const maybePrompt = args._.slice(1).join(" ").toString();

  const prompt = args.p || (maybePrompt ? maybePrompt : maybeInputs);

  const inputsArg = args.i || maybePrompt ? maybeInputs : null;
  const inputFilePaths = inputsArg ? inputsArg.split(",") : [];
  const outputFilePaths = args.o ? args.o.split(",") : inputFilePaths;

  if (!prompt) {
    throw new Error("Prompt is required.");
  } else if (maybeInputs && !maybePrompt) {
    console.warn("Received a single argument, assuming it is prompt");
  }

  return {
    inputFilePaths,
    outputFilePaths,
    prompt,
    modelName: args.m,
    temperature: args.t,
    verbosity: args.s,
  };
}

function readInputFile(inputFilePath: string): string {
  return fs.readFileSync(inputFilePath, "utf-8") || "";
}

function constructPromptWithInput(
  prompt: string,
  inputFilePaths: string[],
  inputContents: string[]
): string {
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

async function getLLMCompletion(
  instruction: string,
  prompt: string,
  model: string,
  temperature: number
): Promise<string> {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${OPENAI_API_KEY}`,
  };

  const body = constructRequestBody(instruction, prompt, model, temperature);

  const response = await fetch(OPENAI_API_URL, {
    headers,
    method: "POST",
    body,
  });

  return handleAPIResponse(response as any as Response);
}

function constructRequestBody(
  instruction: string,
  prompt: string,
  model: string,
  temperature: number
): string {
  return JSON.stringify({
    model,
    temperature,
    messages: [
      {
        role: "system",
        content: instruction,
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    stream: true,
    n: 1,
  });
}

async function handleAPIResponse(response: Response): Promise<string> {
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

    const body = response.body as any;

    body.on("readable", () => {
      let chunk;
      while (null !== (chunk = body.read())) {
        parser.feed(decoder.decode(chunk));
      }
    });

    body.on("end", () => {
      resolve(completionText);
    });

    body.on("error", (err: any) => {
      // reject(err);
      // return response so far despite error e.g. premature close
      reject(completionText);
    });
  });
}

async function extractCodeBlocks(
  completion: string,
  modelName: string
): Promise<{ language: string; codeBlock: string }[]> {
  const codeBlockRegex = /^```([a-z]*)?\s^([\s\S]*?)^```/gm;
  const matches = completion.matchAll(codeBlockRegex);
  const codeBlocks: { language: string; codeBlock: string }[] = [];

  if (matches) {
    for (const match of matches) {
      codeBlocks.push({ language: match[1], codeBlock: match[2] });
    }
  }

  for (const block of codeBlocks) {
    const placeholders = await getLLMCompletion(
      identifyPlaceholdersInstruction,
      block.codeBlock,
      modelName,
      0
    );

    console.log(chalk.white(`Placeholders found: ${placeholders}`));
  }

  return codeBlocks;
}

async function handleUserInput(
  language: string,
  verbosity: number,
  outputFilePath: string
): Promise<boolean | string> {
  return new Promise((resolve) => {
    process.stdin.resume();

    if (verbosity === 0) {
      resolve(true);
    }

    process.stdout.write(
      chalk.white(
        `Do you want to write this ${chalk.yellow(
          language || "unspecified language"
        )} code block to ${chalk.yellow(
          outputFilePath
        )}? \nyes (y) / skip (s) / enter output path (o): `
      )
    );

    process.stdin.once("data", async (data) => {
      const answer = data.toString().trim().toLowerCase();
      if (answer === "yes" || answer === "y") {
        resolve(true);
      } else if (answer === "skip" || answer === "s") {
        resolve(false);
      } else if (answer === "enter output path" || answer === "o") {
        const newPath = await getOutputFilePath();
        resolve(newPath);
      } else {
        resolve(false);
      }
    });
  });
}

async function writeCodeBlockToFile(
  newPath: string,
  codeBlock: string,
  verbosity: number
): Promise<void> {
  try {
    fs.writeFileSync(newPath, codeBlock, "utf-8");
    if (verbosity > 0) {
      console.log(chalk.white(`Code block written to ${newPath}`));
    }
  } catch (error: any) {
    console.error(chalk.red(`Error writing to file: ${error.message}`));
    const newPath = await getOutputFilePath();
    fs.writeFileSync(newPath, codeBlock, "utf-8");
    if (verbosity > 0) {
      console.log(chalk.white(`Code block written to ${newPath}`));
    }
  }
}

async function runTerminalCommand(
  command: string,
  verbosity: number
): Promise<[string, string]> {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        process.stderr.write(
          chalk.red(`Error running command: ${JSON.stringify(error.message)}`)
        );
        reject(error);
        return;
      }

      if (stderr) {
        process.stderr.write(
          chalk.red(`Command stderr: ${JSON.stringify(stderr)}`)
        );
        reject(new Error(stderr));
        return;
      }

      if (verbosity > 0) {
        process.stdout.write(chalk.green(`Command stdout: ${stdout}`));
      }

      resolve([stdout, stderr]);
    });
  });
}

async function getOutputFilePath(): Promise<string> {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdout.write(chalk.white("Enter the new output file path: "));
    process.stdin.once("data", (data) => {
      const newPath = data.toString().trim();
      resolve(newPath);
    });
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(chalk.red(err));
    process.exit(1);
  });
