# docker-git

`docker-git` создаёт отдельную Docker-среду для каждого репозитория, issue или PR.

Теперь есть API-first controller mode:
- хосту нужен только Docker
- поднимается `docker-git-api` controller container
- его state живёт в Docker volume `docker-git-projects`
- controller через Docker API создаёт и обслуживает дочерние project containers
- снаружи ты общаешься с системой через HTTP API или `./ctl`

## Что нужно

- Для controller mode: Docker Engine или Docker Desktop
- Доступ к Docker без `sudo`
- Node.js и `npm` нужны только для legacy host CLI mode

## API Controller Mode

```bash
./ctl up
./ctl health
./ctl projects
```

API публикуется на `http://127.0.0.1:3334` по умолчанию.

```bash
./ctl request GET /projects
./ctl request POST /projects '{"repoUrl":"https://github.com/ProverCoderAI/docker-git.git","repoRef":"main"}'
```

Важно:
- `./ctl` не требует `curl`, `node` или `pnpm` на хосте
- запросы к API выполняются через `curl` внутри controller container
- `.docker-git` больше не обязан лежать на host filesystem: controller хранит его в Docker volume

## Legacy Host CLI

```bash
npm i -g @prover-coder-ai/docker-git
docker-git --help
```

## Пример

Через API controller можно создать проект и потом поднять его отдельно:

```bash
./ctl request POST /projects '{"repoUrl":"https://github.com/ProverCoderAI/docker-git.git","repoRef":"main","up":false}'
./ctl projects
```

API возвращает `projectId`, после чего можно:

```bash
./ctl request POST /projects/<projectId>/up
./ctl request GET /projects/<projectId>/logs
./ctl request POST /projects/<projectId>/down
```

## Проверка Docker runtime

```bash
pnpm run e2e:runtime-volumes-ssh
```

Сценарий доказывает, что контейнер стартует через Docker, runtime state живёт в named volumes, а SSH реально заходит в дочерний project container.

## Подробности

`docker-git --help`
