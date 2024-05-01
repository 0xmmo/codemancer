#!/usr/bin/env ts-node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/index.ts
var import_fs = __toESM(require("fs"));
var import_node_fetch = __toESM(require("node-fetch"));
var import_eventsource_parser = require("eventsource-parser");
var import_yargs = __toESM(require("yargs/yargs"));
var import_helpers = require("yargs/helpers");
var import_chalk = __toESM(require("chalk"));
var import_child_process = require("child_process");
var modifyInstruction = `You are a sophisticated, accurate, and modern AI programming assistant. Whenever you are prompted with a file to modify, you always return the complete code in a fenced code block ready to run without any placeholders and including the unchanged code.`;
var identifyPlaceholdersInstruction = `Below is the code output by an AI programming assistant. This code may contain one or multiple placeholders that the AI creates to be filled in by the user. Please identify and list all the placeholders in this code. For example: "// ...", "Rest of the code remains the same...", "YOUR CODE HERE", "Existing function code ...", etc.`;
var OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
var OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  OPENAI_API_URL = "https://api.codemancer.codes/v1/chat/completions";
  console.error(
    import_chalk.default.red(
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
    verbosity
  } = argv;
  const inputContents = inputFilePaths.map((path) => readInputFile(path));
  const promptWithInput = constructPromptWithInput(
    prompt,
    inputFilePaths,
    inputContents
  );
  if (verbosity > 2) {
    console.log(import_chalk.default.cyan(promptWithInput));
  }
  const completion = await getLLMCompletion(
    modifyInstruction,
    promptWithInput,
    modelName,
    temperature
  );
  if (outputFilePaths.length > 0) {
    const codeBlocks = await extractCodeBlocks(completion);
    if (codeBlocks.length > 0) {
      let cbidx = 0;
      for (const { language, codeBlock } of codeBlocks) {
        const outputFilePath = outputFilePaths[cbidx] || outputFilePaths[0];
        if (verbosity > 1) {
          console.log(import_chalk.default.white("Code block found:"));
          console.log(import_chalk.default.green(codeBlock));
        }
        process.stdout.write(import_chalk.default.white("Identifying placeholders:"));
        const placeholders = await getLLMCompletion(
          identifyPlaceholdersInstruction,
          `${constructPromptWithInput(
            "",
            ["Original Code", "LLM Generated Code"],
            [
              inputContents[cbidx],
              // This should be the final decided outputFilePath contents
              codeBlock
            ]
          )}`,
          "gpt-3.5-turbo",
          0
        );
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
            console.log(import_chalk.default.white("Operation aborted by the user."));
          }
        }
        cbidx++;
      }
    } else {
      if (verbosity > 0) {
        console.log(import_chalk.default.red("No code block found in the completion."));
      }
    }
  }
}
async function configureCommandLineArguments() {
  const args = await (0, import_yargs.default)((0, import_helpers.hideBin)(process.argv)).option("p", {
    alias: "prompt",
    type: "string",
    description: "Prompt for LLM completion"
  }).option("i", {
    alias: "input",
    type: "string",
    description: "Input file paths, separated by commas"
  }).option("o", {
    alias: "output",
    type: "string",
    description: "Output file paths, separated by commas"
  }).option("m", {
    alias: "model",
    type: "string",
    default: "gpt-4",
    description: "Model name"
  }).option("t", {
    alias: "temperature",
    type: "number",
    default: 0,
    description: "Temperature (0-2)"
  }).option("s", {
    alias: "verbosity",
    type: "number",
    default: 2,
    description: "Verbosity (0-3)"
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
    verbosity: args.s
  };
}
function readInputFile(inputFilePath) {
  return import_fs.default.readFileSync(inputFilePath, "utf-8") || "";
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
async function getLLMCompletion(instruction, prompt, model, temperature) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${OPENAI_API_KEY}`
  };
  const body = constructRequestBody(instruction, prompt, model, temperature);
  const response = await (0, import_node_fetch.default)(OPENAI_API_URL, {
    headers,
    method: "POST",
    body
  });
  return handleAPIResponse(response);
}
function constructRequestBody(instruction, prompt, model, temperature) {
  return JSON.stringify({
    model,
    temperature,
    messages: [
      {
        role: "system",
        content: instruction
      },
      {
        role: "user",
        content: prompt
      }
    ],
    stream: true,
    n: 1
  });
}
async function handleAPIResponse(response) {
  const decoder = new TextDecoder();
  return new Promise(async (resolve, reject) => {
    let completionText = "";
    if (!response.ok) {
      const responseBody = await response.text();
      reject(
        `API error: ${response.status} ${response.statusText}
Response body: ${responseBody}`
      );
    }
    const parser = (0, import_eventsource_parser.createParser)((event) => {
      var _a, _b;
      if (event.type !== "event")
        return;
      if (event.data === "[DONE]") {
        process.stdout.write("\n\n");
        resolve(completionText);
        return;
      }
      try {
        const json = JSON.parse(event.data);
        if ((_a = json.choices[0].delta) == null ? void 0 : _a.role)
          return;
        const text = ((_b = json.choices[0].delta) == null ? void 0 : _b.content) || "";
        completionText += text;
        process.stdout.write(import_chalk.default.magenta(text));
      } catch (e) {
        reject(e);
      }
    });
    const body = response.body;
    body.on("readable", () => {
      let chunk;
      while (null !== (chunk = body.read())) {
        parser.feed(decoder.decode(chunk));
      }
    });
    body.on("end", () => {
      resolve(completionText);
    });
    body.on("error", (err) => {
      reject(completionText);
    });
  });
}
async function extractCodeBlocks(completion) {
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
async function handleUserInput(language, verbosity, outputFilePath) {
  return new Promise((resolve) => {
    process.stdin.resume();
    if (verbosity === 0) {
      resolve(true);
    }
    process.stdout.write(
      import_chalk.default.white(
        `Do you want to write this ${import_chalk.default.yellow(
          language || "unspecified language"
        )} code block to ${import_chalk.default.yellow(
          outputFilePath
        )}? 
yes (y) / skip (s) / enter output path (o): `
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
async function writeCodeBlockToFile(newPath, codeBlock, verbosity) {
  try {
    import_fs.default.writeFileSync(newPath, codeBlock, "utf-8");
    if (verbosity > 0) {
      console.log(import_chalk.default.white(`Code block written to ${newPath}`));
    }
  } catch (error) {
    console.error(import_chalk.default.red(`Error writing to file: ${error.message}`));
    const newPath2 = await getOutputFilePath();
    import_fs.default.writeFileSync(newPath2, codeBlock, "utf-8");
    if (verbosity > 0) {
      console.log(import_chalk.default.white(`Code block written to ${newPath2}`));
    }
  }
}
async function runTerminalCommand(command, verbosity) {
  return new Promise((resolve, reject) => {
    (0, import_child_process.exec)(command, (error, stdout, stderr) => {
      if (error) {
        process.stderr.write(
          import_chalk.default.red(`Error running command: ${JSON.stringify(error.message)}`)
        );
        reject(error);
        return;
      }
      if (stderr) {
        process.stderr.write(
          import_chalk.default.red(`Command stderr: ${JSON.stringify(stderr)}`)
        );
        reject(new Error(stderr));
        return;
      }
      if (verbosity > 0) {
        process.stdout.write(import_chalk.default.green(`Command stdout: ${stdout}`));
      }
      resolve([stdout, stderr]);
    });
  });
}
async function getOutputFilePath() {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdout.write(import_chalk.default.white("Enter the new output file path: "));
    process.stdin.once("data", (data) => {
      const newPath = data.toString().trim();
      resolve(newPath);
    });
  });
}
main().then(() => process.exit(0)).catch((err) => {
  console.error(import_chalk.default.red(err));
  process.exit(1);
});
//# sourceMappingURL=index.js.map