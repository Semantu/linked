/** A named alias binding in a scope, tracking its source and nesting depth. */
export type IRAliasBinding = {
  alias: string;
  source: string;
  scopeDepth: number;
};

export class IRAliasScope {
  private bindings = new Map<string, IRAliasBinding>();
  private generatedCount = 0;

  constructor(
    public readonly scopeName: string,
    private readonly parent?: IRAliasScope,
  ) {}

  get depth(): number {
    return this.parent ? this.parent.depth + 1 : 0;
  }

  registerAlias(alias: string, source: string): IRAliasBinding {
    if (this.bindings.has(alias)) {
      throw new Error(`Alias already exists in scope: ${alias}`);
    }
    const binding: IRAliasBinding = {
      alias,
      source,
      scopeDepth: this.depth,
    };
    this.bindings.set(alias, binding);
    return binding;
  }

  generateAlias(source: string): IRAliasBinding {
    let alias: string;
    do {
      alias = `a${this.generatedCount++}`;
    } while (this.bindings.has(alias));
    return this.registerAlias(alias, source);
  }

  resolveAlias(alias: string): IRAliasBinding {
    if (this.bindings.has(alias)) {
      return this.bindings.get(alias);
    }
    if (this.parent) {
      return this.parent.resolveAlias(alias);
    }
    throw new Error(`Alias not found in scope chain: ${alias}`);
  }

  createChildScope(name: string): IRAliasScope {
    return new IRAliasScope(name, this);
  }
}

/** Validates that an alias exists in the current scope chain, throwing if not found. */
export const validateAliasReference = (
  alias: string,
  currentScope: IRAliasScope,
): IRAliasBinding => {
  return currentScope.resolveAlias(alias);
};
