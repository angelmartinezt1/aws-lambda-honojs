import { Todo } from './todo.model.js'
import * as repo from './todo.repository.js'

export async function listTodos (): Promise<Todo[]> {
  return repo.getAllTodos()
}

export async function getTodo (id: string): Promise<Todo | null> {
  return repo.getTodoById(id)
}

export async function addTodo (data: { title: string }): Promise<Todo> {
  return repo.createTodo({ title: data.title, completed: false })
}

export async function editTodo (id: string, data: Partial<Todo>): Promise<Todo | null> {
  return repo.updateTodo(id, data)
}

export async function removeTodo (id: string): Promise<boolean> {
  return repo.deleteTodo(id)
}
