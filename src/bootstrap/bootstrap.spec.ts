import * as fs from 'fs';
import * as path from 'path';

const BOOTSTRAP = path.resolve(process.cwd(), 'scripts', 'bootstrap.sh');

describe('bootstrap.sh', () => {
  it('exists', () => {
    expect(fs.existsSync(BOOTSTRAP)).toBe(true);
  });

  it('is a valid shell script (contains shebang)', () => {
    const content = fs.readFileSync(BOOTSTRAP, 'utf8');
    expect(content.startsWith('#!/usr/bin/env bash')).toBe(true);
  });
});