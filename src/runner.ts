import {spawn, ChildProcess} from 'child_process'
import kill from 'tree-kill'
import * as core from '@actions/core'

export interface Test {
  readonly name: string
  readonly setup: string
  readonly run: string
  readonly input: string
  readonly output: string
}

export class TestError extends Error {
  constructor(message: string) {
    super(message)
    Error.captureStackTrace(this, TestError)
  }
}

export class TestTimeoutError extends TestError {
  constructor(message: string) {
    super(message)
    Error.captureStackTrace(this, TestTimeoutError)
  }
}

export class TestOutputError extends TestError {
  expected: string
  actual: string
  feedback: string

  constructor(message: string, expected: string, actual: string, feedback: string) {
    super(`${message}\nExpected:\n${expected}\nActual:\n${actual}`)
    this.expected = expected
    this.actual = actual
    this.feedback = feedback

    Error.captureStackTrace(this, TestOutputError)
  }
}

const waitForExit = async (child: ChildProcess, timeout: number): Promise<void> => {
  // eslint-disable-next-line no-undef
  return new Promise((resolve, reject) => {
    let timedOut = false
    let error: string | null = null

    const exitTimeout = setTimeout(() => {
      timedOut = true
      reject(new TestTimeoutError(`Setup timed out in ${timeout} milliseconds`))
      kill(child.pid)
    }, timeout)

    child.once('exit', (code: number, signal: string) => {
      if (timedOut) return
      clearTimeout(exitTimeout)

      if (error) {
        reject(new TestError(`Error: ${error}`))
      } else if (code === 0) {
        resolve(undefined)
      } else {
        reject(new TestError(`Error: Exit with code: ${code} and signal: ${signal}`))
      }
    })

    child.once('error', (error: Error) => {
      if (timedOut) return
      clearTimeout(exitTimeout)

      reject(error)
    })

    if (child.stderr) {
      // TODO: may need to generate an annotation here
      child.stderr.on('data', chunk => {
        if (error) error += '\r\n' + chunk
        else error = chunk
      })
    }
  })
}

const runSetup = async (test: Test, cwd: string): Promise<void> => {
  if (!test.setup || test.setup === '') {
    return
  }

  const setup = spawn(test.setup, {
    cwd,
    shell: true,
  })

  await waitForExit(setup, 5000)
}

const runCommand = async (test: Test, cwd: string): Promise<void> => {
  const child = spawn(test.run, {
    cwd,
    shell: true,
  })

  let output = ''

  child.stdout.on('data', chunk => {
    output += chunk + '\r\n'
  })

  // Preload the inputs
  if (test.input && test.input !== '') {
    child.stdin.write(test.input)
    child.stdin.end()
  }

  await waitForExit(child, 5000)

  // TODO: handle comparison modes
  //   - includes
  //   - regex
  //   - equals
  if (!output.includes(test.output)) {
    throw new TestOutputError(`The output for test ${test.name} did not match`, test.output, output, '')
  }
}

export const run = async (test: Test, cwd: string): Promise<void> => {
  await runSetup(test, cwd)
  await runCommand(test, cwd)
}

export const runAll = async (tests: Array<Test>, cwd: string): Promise<void> => {
  for (const test of tests) {
    try {
      console.log(`Running ${test.name}`)
      await run(test, cwd)
      console.log(`${test.name} Passed`)
    } catch (error) {
      core.setFailed(error.message)
    }
  }
}
