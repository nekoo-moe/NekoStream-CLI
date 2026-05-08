import { select, input, confirm } from '@inquirer/prompts'
import readline from 'readline'

export default async function prompts(options: any): Promise<any> {
  const ac = new AbortController()

  // Ensure keypress events are emitted on stdin so we can intercept Esc
  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin)
  }

  const onKeypress = (str: string, key: any) => {
    if (key && key.name === 'escape') {
      ac.abort(new Error('ESC_PRESSED'))
    }
  }

  process.stdin.on('keypress', onKeypress)

  try {
    if (options.type === 'select') {
      const choices = options.choices.map((c: any) => ({
        name: c.title,
        value: c.value,
        description: c.description
      }))

      if (options.message.includes('Esc')) {
        options.message = options.message.replace('(Press Esc to go back)', '(Nhấn Esc để quay lại)').trim()
        choices.push({ name: '[0] 🔙 Go Back', value: '__GOBACK__' })
      }

      const result = await select({
        message: options.message,
        choices: choices,
        pageSize: 15,
        theme: {
          helpMode: 'always',
          style: {
            keysHelpTip: () => '↑↓: cuộn • ↵: chọn • Esc: quay lại'
          }
        } as any // Use as any to inject our custom keysHelpTip if supported, otherwise fallback
      }, { signal: ac.signal });
      
      if (result === '__GOBACK__') {
        return {} 
      }
      
      return { [options.name]: result };
    }
    
    if (options.type === 'text') {
      const result = await input({
        message: options.message.replace('(Press Esc to go back)', '(Nhấn Esc để quay lại)').trim(),
        default: options.initial
      }, { signal: ac.signal });
      return { [options.name]: result };
    }
    
    if (options.type === 'confirm') {
      const result = await confirm({
        message: options.message
      }, { signal: ac.signal });
      return { [options.name]: result };
    }
  } catch (err: any) {
    // Catch Inquirer abort errors (Ctrl+C or our custom Esc abort)
    if (err.name === 'ExitPromptError' || err.name === 'AbortPromptError' || err.message === 'ESC_PRESSED') {
      return {};
    }
    throw err;
  } finally {
    process.stdin.off('keypress', onKeypress)
  }
  return {};
}
