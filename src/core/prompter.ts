// How wizards talk to a person. The terminal implementation lives in src/cli/prompt.ts; tests script it.
export interface Prompter {
  ask(question: string, fallback?: string): Promise<string>;
  secret(question: string): Promise<string>;
  say(message: string): void;
  open(url: string): void;
}
