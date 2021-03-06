import * as program from 'commander';
import * as pkg from 'pjson';
import * as path from 'path';
import * as cp from 'child_process';
import * as fs from 'fs-extra';
import * as inquirer from 'inquirer';
import * as ora from 'ora';
import * as glob from 'glob';
import * as download from 'download-git-repo';
import * as semver from 'semver';
import honoka from 'honoka';
import Config from './Config';
import Validator from './Validator';
import Logger from './Logger';

export = class Cli {
  private logger: Logger;
  private config: Config;

  public constructor() {
    this.logger = new Logger();
    this.config = new Config();
  }

  public register(): void {
    program
      .version(pkg.version)
      .command('init', 'initialize nssr')
      .command('add', 'add a server')
      .command('delete [server]', 'delete a server')
      .command('list', 'list servers')
      .command('start [server]', 'start server')
      .command('stop', 'stop server')
      .command('status', 'server status')
      .parse(process.argv);
  }

  public async init(): Promise<any> {
    if (!this.checkInit(false)) {
      return;
    }

    const answers = await inquirer.prompt({
      type: 'confirm',
      name: 'initialize',
      message: `Do you want to initialize${this.hasInit() ? ' again:' : ':'}`,
      default: true
    });

    if (answers.initialize) {
      fs.removeSync(Config.baseDir);
      fs.mkdirpSync(Config.baseDir);
      fs.mkdirpSync(Config.serverDir);
      const spinner = ora(`downloading library to ${Config.libDir}`);
      spinner.start();
      download(
        'shadowsocksr-backup/shadowsocksr#manyuser',
        Config.libDir,
        { clone: false },
        (err: any) => {
          spinner.stop();
          if (err) {
            throw err;
          } else {
            this.logger.info(`initialized to ${Config.baseDir}`);
          }
        }
      );
    }
  }

  public async add(): Promise<any> {
    if (!this.checkInit()) {
      return;
    }

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'server_name',
        message: 'Friendly server name:',
        validate: (input: string) =>
          input.trim() !== '' && input === path.basename(input)
      },
      {
        type: 'input',
        name: 'server',
        message: 'Server IP or domain:',
        validate: (input: string) =>
          Validator.isIpAddress(input) || Validator.isDomain(input)
      },
      {
        type: 'input',
        name: 'server_port',
        message: 'Server port:',
        validate: (input: string) => Validator.isPort(input)
      },
      {
        type: 'input',
        name: 'local_address',
        message: 'Local address:',
        default: '127.0.0.1',
        validate: (input: string) => Validator.isIpAddress(input)
      },
      {
        type: 'input',
        name: 'local_port',
        message: 'Local port:',
        default: 1080,
        validate: (input: string) => Validator.isPort(input)
      },
      {
        type: 'password',
        name: 'password',
        message: 'Password:',
        validate: (input: string) => input.length > 0
      },
      {
        type: 'list',
        name: 'method',
        message: 'Method:',
        choices: [
          'none',
          'aes-256-cfb',
          'aes-192-cfb',
          'aes-128-cfb',
          'aes-256-cfb8',
          'aes-192-cfb8',
          'aes-128-cfb8',
          'aes-256-ctr',
          'aes-192-ctr',
          'aes-128-ctr',
          'chacha20-ietf',
          'chacha20',
          'rc4-md5',
          'rc4-md5-6'
        ],
        default: 'none'
      },
      {
        type: 'list',
        name: 'protocol',
        message: 'Protocol:',
        choices: [
          'origin',
          'verify_deflate',
          'auth_sha1_v4',
          'auth_sha1_v4_compatible',
          'auth_aes128_md5',
          'auth_aes128_sha1',
          'auth_chain_a',
          'auth_chain_b'
        ],
        default: 'origin'
      },
      {
        type: 'input',
        name: 'protocol_param',
        message: 'Protocol param:',
        default: ''
      },
      {
        type: 'list',
        name: 'obfs',
        message: 'Obfs:',
        choices: [
          'plain',
          'http_simple',
          'http_simple_compatible',
          'http_post',
          'http_post_compatible',
          'tls1.2_ticket_auth',
          'tls1.2_ticket_auth_compatible',
          'tls1.2_ticket_fastauth',
          'tls1.2_ticket_fastauth_compatible'
        ],
        default: 'plain'
      },
      {
        type: 'input',
        name: 'obfs_param',
        message: 'Obfs param:',
        default: ''
      }
    ]);

    answers.local_port = Number(answers.local_port);
    answers.server_port = Number(answers.server_port);

    const serverConfigPath = path.join(
      Config.serverDir,
      `${answers.server_name}.json`
    );
    delete answers.server_name;

    fs.writeFileSync(serverConfigPath, JSON.stringify(answers, null, 4));
    this.logger.info(`create server to ${serverConfigPath}`);
  }

  public delete(): void {
    if (!this.checkInit()) {
      return;
    }

    if (program.args.length === 0) {
      this.logger.warning('server name muse be provided');
    } else {
      const configFile = path.join(Config.serverDir, `${program.args[0]}.json`);
      if (!fs.existsSync(configFile)) {
        this.logger.warning(`server "${program.args[0]}" not exist`);
      } else {
        fs.unlinkSync(configFile);
        this.logger.info(`"${program.args[0]}" has been deleted`);
      }
    }
  }

  public start(): void {
    if (!this.checkInit()) {
      return;
    }

    this.stop();

    if (program.args.length === 0) {
      this.logger.warning('server name muse be provided');
    } else {
      const configFile = path.join(Config.serverDir, `${program.args[0]}.json`);
      if (!fs.existsSync(configFile)) {
        this.logger.warning(`server "${program.args[0]}" not exist`);
      } else {
        cp.execSync(
          `${path.join(
            Config.libDir,
            'shadowsocks',
            'local.py'
          )} -c ${configFile} --pid-file ${Config.pidFile} --log-file ${
            Config.logFile
          } -d start`
        );
        const pid: number = this.getPid();
        if (pid > 0) {
          this.logger.info(`start nssr at process: ${pid}`);
        }
      }
    }
  }

  public stop(): void {
    if (!this.checkInit()) {
      return;
    }

    const pid: number = this.getPid();

    if (pid > 0) {
      try {
        process.kill(pid);
        this.logger.info(`kill nssr at process: ${pid}`);
      } catch (e) {}
      fs.unlinkSync(Config.pidFile);
    }
  }

  public status(): void {
    if (!this.checkInit()) {
      return;
    }

    let isRunning: boolean;
    let pid: number = this.getPid();
    if (pid > 0) {
      try {
        isRunning = !!process.kill(pid, 0);
      } catch (e) {
        isRunning = e.code === 'EPERM';
      }
    } else {
      isRunning = false;
    }
    if (isRunning && pid > 0) {
      this.logger.info(`nssr found running with process: ${pid}`);
    } else {
      this.logger.info('nssr is not running');
    }
  }

  public list(): void {
    if (!this.checkInit()) {
      return;
    }

    glob(path.join(Config.serverDir, '*.json'), (err, files: Array<string>) => {
      if (err) {
        throw err;
      }
      files.forEach(file => {
        this.logger.info(path.basename(file, '.json'));
      });
    });
  }

  private hasInit(): boolean {
    if (!fs.existsSync(Config.baseDir)) {
      return false;
    }
    if (!fs.existsSync(Config.libDir)) {
      return false;
    }
    return true;
  }

  private checkInit(check: boolean = true): boolean {
    program.version(pkg.version).parse(process.argv);
    this.checkUpdate().catch(() => {});

    if (!check) {
      return true;
    }

    if (!this.hasInit()) {
      this.logger.warning('please initialize before use');
      return false;
    }

    return true;
  }

  private getPid(): number {
    if (fs.existsSync(Config.pidFile)) {
      return Number(fs.readFileSync(Config.pidFile));
    }
    return 0;
  }

  private async checkUpdate(): Promise<any> {
    const lastUpdateCheck: number =
      Number(this.config.get('lastUpdateCheck')) || 0;
    if (lastUpdateCheck && Date.now() - lastUpdateCheck < 1000 * 60 * 60 * 24) {
      return;
    }

    let latestPkg: any = await honoka.get(Config.packageURL);
    latestPkg = JSON.parse(latestPkg);
    const latestVersion = latestPkg.version;
    const currentVersion = pkg.version;
    if (!semver.valid(latestVersion)) {
      return;
    }

    this.config.set('lastUpdateCheck', Date.now());

    if (semver.gt(latestVersion, currentVersion)) {
      this.logger.info();
      this.logger.warning(
        `Your current version of nssr is out of date. The latest version is ${latestVersion} while you're on ${currentVersion}.`
      );
      this.logger.info();
    }
  }
};
