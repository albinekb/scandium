const githubPublicKey = 'github.com ssh-rsa AAAAB3NzaC1yc2EAAAABIwAAAQEAq2A7hRGmdnm9tUDbO9IDSwBK6TbQa+PXYPCPy6rbTrTtw7PHkccKrpp0yVhp5HdEIcKr6pLlVDBfOLX9QUsyCOV0wzfjIJNlGEYsdlLJizHhbn2mUjvSAHQqZETYP81eFzLQNnPHt4EVVUh7VfDESU84KezmD5QlWpXLmvU31/yMf+Se8xhHTvKSCZIFImWwoG6mbUoWf9nzpIoaSjB+weqqUUmpaaasXVal72J+UX2B+2RPW3RcT0eOzQgqlJL3RKrTJvdsjE3JEAvGq3lGHSZXy28G3skua2SmVi/w4yCE6gbODqnTWlg7+wC604ydGXA8VJiS5ap43JXiUFFAaQ=='
const sshPostfix = ' && unlink $HOME/.ssh/id_rsa && unlink $HOME/.ssh/id_rsa.pub'
const sshPrefix = 'echo $SSH_PRIVATE_KEY | base64 --decode > $HOME/.ssh/id_rsa && chmod 0600 $HOME/.ssh/id_rsa && echo $SSH_PUBLIC_KEY | base64 --decode > $HOME/.ssh/id_rsa.pub && '

/**
 * @param {object} options
 * @param {boolean} options.prepare
 * @param {boolean} options.sshKey
 * @param {boolean} options.yarn
 * @returns {string}
 */
exports.generate = function (options) {
  const { prepare, sshKey, yarn } = options
  const lines = []

  // Base image on Amazon Linux
  lines.push('FROM amazonlinux:2017.03')

  // Install prerequisites
  lines.push('RUN yum install -y gcc gcc-c++ git make openssl-devel zip')
  lines.push('RUN curl https://nodejs.org/download/release/v8.10.0/node-v8.10.0-linux-x64.tar.gz | tar xz -C /usr --strip-components=1')

  // Install package managers
  lines.push('RUN npm install -g npm@6.4.1')
  if (yarn) lines.push('RUN npm install -g yarn@1.12.3')

  // Set the workdir to same directory as Lambdas executes in
  // Some tools, e.g. Next.js, hard codes the path during the build phase.
  lines.push('WORKDIR /var/task')

  // Copy stripped package files
  // These files have the version stripped, so that docker can cache better.
  // Stripping is not needed on the yarn lockfile, as that doesn't include pacakge version.
  lines.push('COPY scandium-clean-package.json package.json')
  lines.push(`COPY ${yarn ? 'yarn.lock yarn.lock' : 'scandium-clean-package-lock.json package-lock.json'}`)

  // Add build argument for SSH key, and prime known_hosts with GitHub public key
  if (sshKey) lines.push('ARG SSH_PRIVATE_KEY', 'ARG SSH_PUBLIC_KEY', `RUN mkdir -p $HOME/.ssh && echo "${githubPublicKey}" >> $HOME/.ssh/known_hosts`)

  // Add production dependencies
  // This step is run before adding the code, to increase docker cache use.
  lines.push(`RUN ${sshKey ? sshPrefix : ''}${yarn ? 'yarn install --production --frozen-lockfile' : 'npm ci --production'}${sshKey ? sshPostfix : ''}`)
  lines.push('RUN zip -9qyr /output.zip node_modules')

  // Install dev-dependencies, if there is a `prepare` script present
  if (prepare) lines.push(`RUN ${sshKey ? sshPrefix : ''}${yarn ? 'yarn install --frozen-lockfile' : 'npm ci'}${sshKey ? sshPostfix : ''}`)

  // Add the app files, and remove our special files
  lines.push('COPY . .')
  if (yarn) {
    lines.push('RUN rm scandium-clean-package.json scandium-dockerfile')
  } else {
    lines.push('RUN rm scandium-clean-package.json scandium-clean-package-lock.json scandium-dockerfile')
  }

  // Run the `prepare` script, if present
  if (prepare) lines.push('RUN npm run-script prepare')

  // Add the local code to the zip
  lines.push('RUN rm -r node_modules')
  lines.push('RUN zip -9qyrg /output.zip .')

  // Give the zip to the caller
  lines.push('CMD cat /output.zip | base64')

  return lines.join('\n')
}
