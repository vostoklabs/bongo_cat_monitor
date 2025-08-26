#!/usr/bin/env python3
"""
Windows Task Scheduler management
"""

import subprocess

def run(cmd):
    return subprocess.run(["powershell", "-Command", cmd], capture_output=True, shell=True)


class Task:

    def __init__(self, name, **kwargs):
        """A Task object.

        Args:
            name (str): The name of the task.
            debug (bool, optional): If True, will print the command being run. Defaults to False.
        """        
        self.name = name

        self.task_exists = self.exists()
        if not self.task_exists:
            raise ValueError(f"Task '{self.name}' does not exist!")        

        self.debug = False
        self.__dict__.update(kwargs)
        
    def print(self, text):
        """Prints text to the console, if debug is True.

        Args:
            text (str): The text to print.
        """        
        if self.debug:
            print(text)    

    def exists(self):
        """Checks if the task exists."""    

        task_info = run(f'Get-ScheduledTaskInfo -TaskName "{self.name}"')

        if task_info.returncode == 0:
            attrs = {el.split(':', 1)[0]: el.split(':', 1)[1] for el in task_info.stdout.decode('utf-8').split('\r\n') if el != ''}
            attrs = {k.strip(): v.strip() for k, v in attrs.items()}
            self.folder = attrs['TaskPath']
            return True
        else: 
            self.folder = None
            return False            
            
    def set_enabled(self, enabled: bool):
        """
        Enables or disables the task in the Windows Task Scheduler.
        Args:
            enabled (bool): True to enable, False to disable
        """
        if self.task_exists:
            action = "Enable" if enabled else "Disable"
            self.print(f'{action} task: {self.folder}{self.name}')
            result = run(f'{action}-ScheduledTask -TaskName "{self.name}"')
            if result.returncode == 0:
                self.print(f'Task {action.lower()}d: {self.folder}{self.name}')
                return True
            else:
                self.print(f'Failed to {action.lower()} task: {self.folder}{self.name}. Error: {result.stderr.decode("utf-8")}')
        else:
            self.print(f'Task does not exist: {self.folder}{self.name}. Cannot {"enable" if enabled else "disable"}.')
        return False