import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import { registerCommand } from "./index";

describe("registerCommand", () => {
  test("attaches a subcommand with the given name and description", () => {
    const program = new Command();
    const cmd = registerCommand(program, {
      name: "foo",
      description: "Foo command",
    });
    expect(cmd).toBeDefined();
    expect(cmd.name()).toBe("foo");
    expect(cmd.description()).toBe("Foo command");
  });

  test("returns the newly-created subcommand", () => {
    const program = new Command();
    const cmd = registerCommand(program, {
      name: "bar",
      description: "Bar command",
    });
    expect(program.commands.find((c) => c.name() === "bar")).toBe(cmd);
  });

  test("invokes the configure callback with the new subcommand", () => {
    const program = new Command();
    let received: Command | undefined;
    registerCommand(program, {
      name: "baz",
      description: "Baz command",
      configure: (cmd) => {
        received = cmd;
        cmd.option("-x, --xtra <value>", "extra");
      },
    });
    expect(received).toBeDefined();
    expect(received!.name()).toBe("baz");
    const baz = program.commands.find((c) => c.name() === "baz");
    expect(baz?.options.find((o) => o.long === "--xtra")).toBeDefined();
  });

  test("omitting configure is allowed and does not throw", () => {
    const program = new Command();
    expect(() =>
      registerCommand(program, { name: "qux", description: "Qux" }),
    ).not.toThrow();
    expect(program.commands.find((c) => c.name() === "qux")).toBeDefined();
  });
});
